import { BRAND_NAME_FULL } from "@shared/brand";
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  LeftOutlined,
  PlayCircleFilled,
  DownOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SettingOutlined,
  SnippetsOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Graph, type GraphData } from "@antv/g6";
import { AccountPanel } from "./AccountPanel";
import { AuthProvider } from "@/lib/use-auth";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** 「扩展中心」页的三层（跟 CapabilityLibraryPage 的 tab 一一对应）。 */
export type CapabilityLayer = "skills" | "connectors" | "partners";

export type ViewKey =
  | "sliderule"
  | "workbench"
  | "workbench-legacy"
  | "skills"
  | "components"
  | "help"
  | "settings"
  | "settings-legacy"
  | "dashboard"
  | "admin";

// 技能库（索引 JSON 打在页面 chunk 里）：点开才加载，不占主包
/* 2026-08-25：技能库升级成「扩展中心」一页三层（用户裁决，
   参照豆包工作台）。view key 仍叫 skills——换 key 会让已有的深链和
   AccountPanel 里那个入口一起失效，而这次改的是页面内容不是导航语义。 */
const LazySkillStorePage = React.lazy(
  () => import("@/pages/sliderule/SkillStorePage")
);

// 组件库：清单读自 experience_block_catalog.json，每个区块用真实渲染器现渲，
// 所以这份 chunk 会拖上 ECharts/ProComponents——必须懒加载，不能压进主包。
const LazyComponentsLibraryPage = React.lazy(
  () => import("@/pages/sliderule/ComponentsLibraryPage")
);

// 帮助中心（E15，markdown 文档打在独立 chunk）：点开才加载
const LazyHelpCenterPage = React.lazy(
  () => import("../help/HelpCenterPage")
);

export function shouldRequestSettingsForView(view: ViewKey): boolean {
  // legacy 驾驶舱/legacy 设置页才消费 AgentLoop settings payload；
  // 新工作台（主线观察台）/推演页/设置整页（SettingsPage 自管本地配置）都不需要。
  return view === "settings-legacy" || view === "workbench-legacy";
}
import SlideRulePage from "@/pages/SlideRule";
import { ShellSidebarProvider, useShellSidebar } from "@/pages/sliderule/ShellSidebarContext";
import { SettingsPage } from "@/pages/sliderule/SettingsDialog";
import { AccountDashboardPage } from "./UserDashboardPage";
import { SidebarSessions } from "./SidebarSessions";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { AppsWorkbench } from "./AppsWorkbench";
import { MainlineWorkbench } from "./MainlineWorkbench";
import type {
  AgentLoopSettingsViewModel,
  DetailPayload,
  OverviewPayload,
  OverviewTask,
  PythonHealthViewModel,
} from "./dashboardTypes";
import { postCommand } from "./bridge";
import {
  fetchPythonHealth,
  filterSupportedQueuePatch,
  normalizePythonHealthViewModel,
} from "./agentLoopApi";
import SettingsView from "./settings/SettingsView";
import { CliConfigForm } from "./settings/CliConfigPanel";
import { QueueDefaultsView } from "./settings/QueueDefaultsPanel";
import { ProfileCrudView } from "./settings/ProfilesPanel";
import {
  fetchJsonSafe,
  isPythonBackendFailure,
  isDegradedApiError,
} from "@/lib/api-client";
import { LegacyUnmaintainedBanner } from "@/components/LegacyUnmaintainedBanner";

const { Header, Content } = Layout;
const { Text, Title } = Typography;

const PAGE_SIZE = 10;
const CATEGORY_ORDER = [
  "queue",
  "all",
  "attention",
  "running",
  "landed",
  "pending",
  "disabled",
] as const;

type FilterKey = (typeof CATEGORY_ORDER)[number];

const FILTER_LABELS: Record<FilterKey, string> = {
  queue: "任务队列",
  all: "全部任务",
  attention: "需关注",
  running: "进行中",
  landed: "已落地",
  pending: "待跑",
  disabled: "已禁用",
};

const STATUS_TONE: Record<string, string> = {
  done: "success",
  applied: "success",
  reviewed: "success",
  manualRescueLanded: "success",
  noDiff: "default",
  running: "processing",
  pending: "default",
  disabled: "default",
  stale: "warning",
  stopped: "warning",
  applyConflict: "warning",
  rescuePatch: "warning",
  human: "warning",
  failed: "error",
  crashed: "error",
  quarantined: "warning",
};

const CODE_TOKEN_CLASS_NAMES: Record<string, string> = {
  key: "native-code-token native-code-key",
  string: "native-code-token native-code-string",
  number: "native-code-token native-code-number",
  boolean: "native-code-token native-code-boolean",
  null: "native-code-token native-code-null",
  punctuation: "native-code-token native-code-punctuation",
};

function countValue(counts: OverviewPayload["counts"], key: string): number {
  return Number(counts?.[key]) || 0;
}

function queueTasks(tasks: OverviewTask[]): OverviewTask[] {
  return tasks.filter(task => task.inQueue !== false && task.enabled !== false);
}

function taskCategory(task: OverviewTask): FilterKey {
  if (task.running) return "running";
  if (task.enabled === false) return "disabled";
  if (task.category && CATEGORY_ORDER.includes(task.category as FilterKey)) {
    return task.category as FilterKey;
  }
  const badge = task.outcomeGroup || task.badge || task.outcome || "pending";
  if (
    [
      "failed",
      "crashed",
      "quarantined",
      "stale",
      "human",
      "rescuePatch",
      "applyConflict",
      "stopped",
    ].includes(badge)
  ) {
    return "attention";
  }
  if (
    ["done", "applied", "reviewed", "manualRescueLanded", "noDiff"].includes(
      badge
    )
  ) {
    return "landed";
  }
  return "pending";
}

function statusColor(task: OverviewTask): string {
  return (
    STATUS_TONE[task.outcomeGroup || task.badge || task.outcome || "pending"] ||
    "default"
  );
}

function statusLabel(task: OverviewTask): string {
  if (task.statusLabel) return task.statusLabel;
  const key = task.outcomeGroup || task.badge || task.outcome || "pending";
  const labels: Record<string, string> = {
    done: "完成",
    applied: "已落地",
    reviewed: "已审查",
    noDiff: "无新增 diff",
    manualRescueLanded: "人工救回",
    running: "运行中",
    pending: "待跑",
    disabled: "已禁用",
    stale: "运行中断",
    stopped: "已停止",
    applyConflict: "应用冲突",
    rescuePatch: "可救援补丁",
    human: "人工接管",
    failed: "失败",
    crashed: "崩溃",
    quarantined: "隔离",
  };
  return labels[key] || key;
}

function closureStatusParts(task: OverviewTask): string[] {
  const closure = task.closureStatus;
  if (!closure) return [];
  // E27：徽章说人话——哈希摘要对用户是噪音，不再上卡
  const parts = [closure.blocked ? "闭环被闸拦截" : "闭环已收口"];
  const evidence = Number(closure.evidencePresentCount);
  const skills = Number(closure.skillCount);
  if (Number.isFinite(evidence) && Number.isFinite(skills) && skills > 0) {
    parts.push(`证据 ${evidence}/${skills}`);
  } else if (Number.isFinite(evidence) && evidence > 0) {
    parts.push(`证据 ${evidence} 项`);
  }
  const blockers = Number(closure.blockerCount);
  if (Number.isFinite(blockers) && blockers > 0) {
    parts.push(`阻塞 ${blockers} 项`);
  }
  return parts;
}

function ClosureStatusBadge({ task }: { task: OverviewTask }) {
  const parts = closureStatusParts(task);
  if (parts.length === 0) return null;
  return (
    <Tag
      data-testid="agentloop-task-closure-status"
      color={task.closureStatus?.blocked ? "warning" : "success"}
      className="native-closure-status"
    >
      {parts.join(" · ")}
    </Tag>
  );
}

function taskLabel(task: OverviewTask): string {
  return (
    task.taskLabel ||
    task.task.split("/").pop()?.replace(/\.md$/, "") ||
    task.task
  );
}

function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes) || 0;
  if (value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  return `${Math.round(value / 1024)} KB`;
}

function queueName(path: string | null | undefined): string {
  if (!path) return "";
  return String(path).split(/[\\/]/).pop() || String(path);
}

function formatAgentPair(task: OverviewTask): string {
  const parts = [task.fixAgent, task.reviewAgent]
    .filter(Boolean)
    .map(agent => titleCaseAgent(agent, ""));
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function stateUpdatedText(task: OverviewTask): string {
  return task.stateUpdatedText || task.lastUpdatedText || "-";
}

function latestAttemptText(task: OverviewTask): string {
  return task.latestAttemptText || task.lastUpdatedText || "-";
}

function sumDiffBytes(iterations: Array<Record<string, unknown>>): number {
  return iterations.reduce(
    (sum, iteration) => sum + (Number(iteration.diffBytes) || 0),
    0
  );
}

function compactText(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function jsonPreview(value: unknown): string {
  if (typeof value === "string") return value || "暂无内容";
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function statusTone(
  status: string | null | undefined
): "success" | "processing" | "warning" | "error" | "default" {
  const text = String(status || "").toLowerCase();
  if (text.includes("done") || text.includes("green") || text.includes("pass"))
    return "success";
  if (text.includes("fix") || text.includes("review") || text.includes("run"))
    return "processing";
  if (
    text.includes("halt") ||
    text.includes("pending") ||
    text.includes("stale")
  )
    return "warning";
  if (text.includes("fail") || text.includes("crash") || text.includes("red"))
    return "error";
  return "default";
}

function titleCaseAgent(value: unknown, fallback: string): string {
  const text = compactText(value, fallback).toLowerCase();
  if (!text || text === "-") return fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function blockCount(payload: DetailPayload): number {
  const statusBlock =
    String(payload.status || "").startsWith("HALT_") ||
    payload.status === "STALE_INTERRUPTED"
      ? 1
      : 0;
  const eventBlocks = (payload.events || []).filter(event => {
    const status = String(event.status || "").toUpperCase();
    return (
      status.startsWith("HALT_") ||
      status.includes("FAIL") ||
      status.includes("ERROR")
    );
  }).length;
  return Math.max(statusBlock, eventBlocks);
}

function filterTasks(
  tasks: OverviewTask[],
  filter: FilterKey,
  query: string
): OverviewTask[] {
  const base =
    filter === "queue"
      ? queueTasks(tasks)
      : filter === "all"
        ? tasks
        : tasks.filter(task => taskCategory(task) === filter);
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return base;
  return base.filter(task => {
    const haystack = [
      task.id,
      task.task,
      task.taskLabel,
      task.statusLabel,
      task.outcome,
      task.outcomeGroup,
      task.agent,
      task.fixAgent,
      task.reviewAgent,
      task.branch,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

function filterCount(
  tasks: OverviewTask[],
  filter: FilterKey,
  counts: OverviewPayload["counts"]
): number {
  if (filter === "queue")
    return countValue(counts, "queueTotal") || queueTasks(tasks).length;
  if (filter === "all") return countValue(counts, "total") || tasks.length;
  return tasks.filter(task => taskCategory(task) === filter).length;
}

function landedCount(
  counts: OverviewPayload["counts"],
  tasks: OverviewTask[] = []
): number {
  const fromTasks = tasks.filter(
    task => taskCategory(task) === "landed"
  ).length;
  if (tasks.length > 0) return fromTasks;
  return Math.max(
    countValue(counts, "done"),
    countValue(counts, "applied"),
    countValue(counts, "reviewed"),
    countValue(counts, "manualRescueLanded"),
    countValue(counts, "noDiff")
  );
}

function attentionCount(
  counts: OverviewPayload["counts"],
  tasks: OverviewTask[] = []
): number {
  return (
    countValue(counts, "attention") ||
    tasks.filter(task => taskCategory(task) === "attention").length
  );
}

function landingPatchCount(landing: unknown): number {
  const value = landing as any;
  const counted = Number(value?.taskCounts?.patch);
  if (Number.isFinite(counted)) return counted;
  if (Array.isArray(value?.patchTasks)) return value.patchTasks.length;
  if (Array.isArray(value?.tasks)) {
    const done = value.tasks.filter(
      (task: any) => task?.outcome === "done"
    ).length;
    return done || value.tasks.length;
  }
  return 0;
}

function isLandingApplied(landing: unknown): boolean {
  const value = landing as any;
  const status = String(value?.status || "");
  return (
    Boolean(value?.appliedToMain) ||
    [
      "APPLIED_TO_MAIN",
      "APPLIED_TO_MAIN_MANUAL",
      "MAIN_GATE_GREEN",
      "COMMITTED",
    ].includes(status)
  );
}

function shouldShowLandingStatus(landing: unknown): boolean {
  const value = landing as any;
  if (!value || typeof value !== "object") return false;
  if (String(value.status || "") === "QUEUE_VERIFIED_NO_DIFF") return false;
  if (isLandingApplied(value)) return true;
  return (
    String(value.status || "") === "PENDING_QUEUE_LANDING" &&
    Number(value.diffBytes || 0) > 0
  );
}

function OverviewHeader({
  payload,
  settings,
}: {
  payload: OverviewPayload;
  settings?: AgentLoopSettingsViewModel | null;
}) {
  const queueRunning = Boolean(payload.queueRunning);
  const queueTotal =
    countValue(payload.counts, "queueTotal") ||
    queueTasks(payload.tasks || []).length;
  const total =
    countValue(payload.counts, "total") || (payload.tasks || []).length;
  const eff = (settings && (settings.nonSensitive || settings)) || {};
  const ap = settings?.activeProfile || (eff as any).activeProfile || "";
  const f = settings?.fixAgent || (eff as any).fixAgent || "";
  const r = settings?.reviewAgent || (eff as any).reviewAgent || "";
  const activeQueuePath =
    payload.queuePath || settings?.queuePath || (eff as any).queuePath || "";
  const latestQueuePath = payload.latestQueuePath || "";
  const hasQueuePath = Boolean(activeQueuePath);
  const queueStale = Boolean(
    payload.queueStale &&
    latestQueuePath &&
    activeQueuePath &&
    latestQueuePath !== activeQueuePath
  );
  const landing = payload.landing as any;
  const showLanding = shouldShowLandingStatus(landing);
  const landingApplied = isLandingApplied(landing);
  const landingCommitRange =
    landing?.appliedCommitRange ||
    (Array.isArray(landing?.appliedCommits)
      ? landing.appliedCommits.join(", ")
      : "");
  const landingDiffKb = landing?.diffBytes
    ? `${Math.max(1, Math.round(Number(landing.diffBytes) / 1024))} KB`
    : "0 KB";
  const landingTasks = landingPatchCount(landing);
  const rtOpts = {
    ...(f ? { fixAgent: f } : {}),
    ...(r ? { reviewAgent: r } : {}),
    ...(ap ? { activeProfile: ap } : {}),
    ...((eff as any).workerMaxTurns != null
      ? { workerMaxTurns: (eff as any).workerMaxTurns }
      : {}),
    ...((eff as any).workerMaxRetries != null
      ? { workerMaxRetries: (eff as any).workerMaxRetries }
      : {}),
    ...((eff as any).worktreeScope
      ? { worktreeScope: (eff as any).worktreeScope }
      : {}),
    ...((eff as any).queuePath ? { queuePath: (eff as any).queuePath } : {}),
  };

  return (
    <section className="native-workbench-hero">
      <div className="native-hero-title-row">
        <div className="native-hero-copy">
          <Text type="secondary" className="native-hero-eyebrow">
            AGENTLOOP WORKBENCH
          </Text>
          <Title level={2}>任务队列驾驶舱</Title>
          <Text type="secondary">
            {queueTotal} 个队列任务为 {total}{" "}
            个全部任务，本地运行、审查、落地集中在这里。
          </Text>
          {(ap || f || r) && (
            <div className="native-hero-tags">
              <Tag color="blue">活跃设置</Tag>
              {ap ? <Tag>Profile: {ap}</Tag> : null}
              {f || r ? (
                <Tag>
                  Agent: {f || "grok"} / {r || "codex"}
                </Tag>
              ) : null}
            </div>
          )}
        </div>
        <Space wrap size="small" className="native-hero-actions">
          <Tag color={queueRunning ? "processing" : "default"}>
            {queueRunning ? "运行中" : "待命"}
          </Tag>
          {queueRunning ? (
            <Button danger onClick={() => postCommand("stopRun")}>
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlayCircleFilled />}
              onClick={() => postCommand("runQueue", rtOpts)}
            >
              运行队列
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => postCommand("refresh")}
          >
            刷新
          </Button>
        </Space>
      </div>
      {hasQueuePath ? (
        <div className="native-queue-path-row">
          <Space wrap size={[4, 4]}>
            <Tag color={queueStale ? "warning" : "default"}>当前队列</Tag>
            <Text code>{queueName(activeQueuePath)}</Text>
            <Text
              type="secondary"
              className="native-task-path"
              ellipsis={{ tooltip: activeQueuePath }}
            >
              {activeQueuePath}
            </Text>
            {(ap || f || r) && (
              <>
                <Tag color="blue">Profile: {ap || "local"}</Tag>
                <Tag>
                  Agent: {f || "grok"} / {r || "codex"}
                </Tag>
              </>
            )}
          </Space>
        </div>
      ) : null}
      {showLanding ? (
        <Alert
          type={landingApplied ? "success" : "warning"}
          showIcon
          style={{ marginTop: 12 }}
          message={
            landingApplied
              ? "Queue landing applied to main"
              : "Queue landing pending"
          }
          description={
            <Space direction="vertical" size={2}>
              <Text>
                {landingApplied
                  ? "Manual landing recorded"
                  : "Patch still needs landing"}
                : {landingTasks} patch tasks, {landingDiffKb} diff.
              </Text>
              {landingCommitRange ? (
                <Text code>{landingCommitRange}</Text>
              ) : null}
              {landing?.appliedAt ? (
                <Text type="secondary">
                  Applied at {String(landing.appliedAt)}
                </Text>
              ) : null}
            </Space>
          }
        />
      ) : null}
      {queueStale ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="检测到更新队列"
          description={
            <Space direction="vertical" size={2}>
              <Text>当前页面仍在读取 {queueName(activeQueuePath)}</Text>
              <Text>最新队列是 {queueName(latestQueuePath)}</Text>
              <Text
                type="secondary"
                className="native-task-path"
                ellipsis={{ tooltip: latestQueuePath }}
              >
                {latestQueuePath}
              </Text>
            </Space>
          }
        />
      ) : null}
    </section>
  );
}

function MetricCard({
  icon,
  title,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  hint: string;
  tone: "blue" | "green" | "orange" | "purple";
}) {
  return (
    <Card
      className={`native-metric-card native-metric-card-${tone}`}
      variant="borderless"
    >
      <div className="native-metric-card-head">
        <span className="native-metric-icon">{icon}</span>
        <Text type="secondary">{title}</Text>
      </div>
      <div className="native-metric-value">{value}</div>
      <Text type="secondary" className="native-metric-hint">
        {hint}
      </Text>
    </Card>
  );
}

function SummaryStats({ payload }: { payload: OverviewPayload }) {
  const counts = payload.counts || {};
  const tasks = payload.tasks || [];
  const queueTotal =
    countValue(counts, "queueTotal") || queueTasks(tasks).length;
  const total = countValue(counts, "total") || tasks.length;
  const landed = landedCount(counts, tasks);
  const running =
    countValue(counts, "running") || tasks.filter(task => task.running).length;
  const attention = attentionCount(counts, tasks);

  return (
    <div className="native-workbench-metrics">
      <MetricCard
        icon={<SnippetsOutlined />}
        title="队列任务"
        value={queueTotal}
        hint={`全部 ${total} 个任务`}
        tone="blue"
      />
      <MetricCard
        icon={<PlayCircleFilled />}
        title="运行中"
        value={running}
        hint={payload.queueRunning ? "队列正在推进" : "当前没有运行"}
        tone="green"
      />
      <MetricCard
        icon={<ClockCircleOutlined />}
        title="需关注"
        value={attention}
        hint="失败, 冲突, 阻塞会出现在这里"
        tone="orange"
      />
      <MetricCard
        icon={<FileDoneOutlined />}
        title="已落地"
        value={landed}
        hint="通过审查或已应用到主线"
        tone="purple"
      />
    </div>
  );
}

function taskRunCandidate(task: OverviewTask): string {
  return String(task.lastRunId || task.id || task.task || "");
}

function QueueTable({
  tasks,
  getTaskRunPath,
  onOpenTask,
}: {
  tasks: OverviewTask[];
  getTaskRunPath?: (runId: string) => string;
  onOpenTask?: (taskPath: string, runId?: string | null) => void;
}) {
  const openTask = (event: React.MouseEvent, task: OverviewTask) => {
    if (onOpenTask) {
      event.preventDefault();
      onOpenTask(task.task, taskRunCandidate(task));
      return;
    }
    postCommand("openTask", {
      taskPath: task.task,
      runId: task.lastRunId || task.id,
    });
  };
  const taskHref = (task: OverviewTask) => {
    const runId = taskRunCandidate(task);
    return getTaskRunPath && runId ? getTaskRunPath(runId) : undefined;
  };

  const columns: ColumnsType<OverviewTask> = [
    {
      title: "状态",
      key: "status",
      width: 86,
      render: (_, task) => (
        <Tag color={statusColor(task)}>{statusLabel(task)}</Tag>
      ),
    },
    {
      title: "任务",
      key: "task",
      width: 330,
      render: (_, task) => (
        <Space direction="vertical" size={0}>
          <Typography.Link
            href={taskHref(task)}
            onClick={event => openTask(event, task)}
          >
            {taskLabel(task)}
          </Typography.Link>
          <Text
            type="secondary"
            className="native-task-path"
            ellipsis={{ tooltip: task.task }}
          >
            {task.task}
          </Text>
          <ClosureStatusBadge task={task} />
        </Space>
      ),
    },
    {
      title: "Agent",
      key: "agent",
      width: 100,
      render: (_, task) => (
        <span className="native-nowrap">
          {task.agent || formatAgentPair(task)}
        </span>
      ),
    },
    {
      title: "分支",
      key: "branch",
      width: 150,
      render: (_, task) => (
        <Text
          className="native-branch-cell"
          ellipsis={{ tooltip: task.branch || "-" }}
        >
          {task.branch || "-"}
        </Text>
      ),
    },
    {
      title: "变更",
      key: "diff",
      width: 70,
      render: (_, task) => (
        <span className="native-nowrap">{formatBytes(task.diffBytes)}</span>
      ),
    },
    {
      title: "状态时间",
      key: "stateUpdated",
      width: 112,
      render: (_, task) => stateUpdatedText(task),
    },
    {
      title: "最近尝试",
      key: "latestAttempt",
      width: 112,
      render: (_, task) => latestAttemptText(task),
    },
    {
      title: "操作",
      key: "action",
      width: 70,
      render: (_, task) => (
        <Space>
          <Typography.Link
            href={taskHref(task)}
            onClick={event => openTask(event, task)}
          >
            详情
          </Typography.Link>
          {task.enabled === false && task.id ? (
            <Button
              size="small"
              onClick={() => postCommand("reEnable", { taskId: task.id })}
            >
              启用
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Table
      className="native-workbench-table"
      rowKey={task => task.id || task.task}
      columns={columns}
      dataSource={tasks}
      pagination={{
        pageSize: PAGE_SIZE,
        showSizeChanger: false,
        showTotal: (total: number) => `共 ${total} 条`,
      }}
      scroll={{ x: 918 }}
      tableLayout="fixed"
    />
  );
}

function CurrentRun({ current }: { current: OverviewPayload["current"] }) {
  if (!current) {
    return <Alert type="info" showIcon message="当前没有运行中的任务" />;
  }
  const baseDesc = `${current.phaseLabel || current.status || "-"} · ${current.elapsedText || "-"}`;
  const prof = (current as any).profileName
    ? ` · 激活 Profile: ${(current as any).profileName}`
    : "";
  return (
    <Alert
      type={current.staleRun ? "warning" : "info"}
      showIcon
      message={current.taskLabel || "当前运行"}
      description={`${baseDesc}${prof}`}
    />
  );
}

function TaskInspector({
  payload,
  settings,
  task,
  getTaskRunPath,
  onOpenTask,
}: {
  payload: OverviewPayload;
  settings?: AgentLoopSettingsViewModel | null;
  task: OverviewTask | null;
  getTaskRunPath?: (runId: string) => string;
  onOpenTask?: (taskPath: string, runId?: string | null) => void;
}) {
  const counts = payload.counts || {};
  const tasks = payload.tasks || [];
  const total = countValue(counts, "total") || tasks.length || 1;
  const landed = landedCount(counts, tasks);
  const progress = Math.min(100, Math.round((landed / total) * 100));
  const eff = (settings && (settings.nonSensitive || settings)) || {};
  const profLabel = settings?.activeProfile || (eff as any).activeProfile;
  const status = task ? statusLabel(task) : "空闲";
  const tone = task ? statusColor(task) : "default";
  const runId = task ? taskRunCandidate(task) : "";
  const taskHref =
    task && getTaskRunPath && runId ? getTaskRunPath(runId) : undefined;
  const taskDone = task ? taskCategory(task) === "landed" : false;
  const taskProgress = taskDone ? 100 : task?.running ? 68 : task ? 34 : 0;
  const openTask = (event: React.MouseEvent) => {
    if (!task) return;
    if (onOpenTask) {
      event.preventDefault();
      onOpenTask(task.task, runId);
      return;
    }
    postCommand("openTask", {
      taskPath: task.task,
      runId: task.lastRunId || task.id,
    });
  };

  return (
    <Card className="native-task-inspector" variant="borderless">
      <div className="native-inspector-head">
        <span className="native-inspector-head-title">当前任务</span>
        <Tag color={tone}>{status}</Tag>
        <span className="native-inspector-close">×</span>
      </div>
      <div className="native-inspector-current">
        <CurrentRun current={payload.current || null} />
      </div>

      {task ? (
        <>
          <div className="native-inspector-task-header">
            <Typography.Link
              href={taskHref}
              onClick={openTask}
              className="native-inspector-task-title"
            >
              {taskLabel(task)}
            </Typography.Link>
            <Text
              type="secondary"
              className="native-task-path native-inspector-task-path"
              ellipsis={{ tooltip: task.task }}
            >
              {task.task}
            </Text>
            <ClosureStatusBadge task={task} />
          </div>

          <div className="native-inspector-meta">
            <div className="meta-row">
              <Text type="secondary" className="meta-label">
                Agent
              </Text>
              <Text strong className="meta-value" ellipsis>
                {task.agent || formatAgentPair(task)}
              </Text>
            </div>
            <div className="meta-row">
              <Text type="secondary" className="meta-label">
                分支
              </Text>
              <Text
                strong
                className="meta-value"
                ellipsis={{ tooltip: task.branch || "-" }}
              >
                {task.branch || "-"}
              </Text>
            </div>
            <div className="meta-row">
              <Text type="secondary" className="meta-label">
                状态时间
              </Text>
              <Text strong className="meta-value">
                {stateUpdatedText(task)}
              </Text>
            </div>
            <div className="meta-row">
              <Text type="secondary" className="meta-label">
                最近尝试
              </Text>
              <Text strong className="meta-value">
                {latestAttemptText(task)}
              </Text>
            </div>
          </div>

          <div className="inspector-scroll-area">
            <div className="native-inspector-kpis">
              <div>
                <span>{formatBytes(task.diffBytes)}</span>
                <Text type="secondary">变更量</Text>
              </div>
              <div>
                <span>{runId ? "1" : "0"}</span>
                <Text type="secondary">运行记录</Text>
              </div>
              <div>
                <span>{task.enabled === false ? "停用" : "启用"}</span>
                <Text type="secondary">队列状态</Text>
              </div>
            </div>

            {/* 关键指标 grid to match effect diagram */}
            <div className="native-key-metrics">
              <Text type="secondary" className="native-key-metrics-label">
                关键指标
              </Text>
              <div className="native-key-metrics-grid">
                <div>
                  <span>
                    {Math.max(0, Math.round((task?.diffBytes || 4000) / 350))}
                  </span>
                  <Text type="secondary">新增行</Text>
                </div>
                <div>
                  <span>
                    {Math.max(0, Math.round((task?.diffBytes || 3000) / 520))}
                  </span>
                  <Text type="secondary">删除行</Text>
                </div>
                <div>
                  <span>
                    {task
                      ? task.diffBytes
                        ? Math.max(1, Math.floor((task.diffBytes || 0) / 2000))
                        : 1
                      : 0}
                  </span>
                  <Text type="secondary">总变更</Text>
                </div>
                <div>
                  <span>12/12</span>
                  <Text type="secondary">测试通过</Text>
                </div>
              </div>
            </div>

            <div>
              <div className="native-inspector-progress-head">
                <Text type="secondary">任务推进</Text>
                <Text strong>{taskProgress}%</Text>
              </div>
              <Progress
                percent={taskProgress}
                showInfo={false}
                status={
                  taskDone ? "success" : task?.running ? "active" : "normal"
                }
              />
            </div>

            <div className="native-inspector-summary">
              <Text type="secondary" className="native-inspector-summary-label">
                任务摘要
              </Text>
              <Text type="secondary">
                {taskDone
                  ? "这条任务已经进入已审查或已落地状态，可以从详情继续核对证据。"
                  : "这条任务还需要继续跑队列或人工核查，优先看运行记录和变更分支。"}
              </Text>
            </div>

            <div className="native-inspector-timeline">
              <Text type="secondary" className="native-inspector-summary-label">
                时间线
              </Text>
              <div
                className={`native-inspector-timeline-item native-inspector-timeline-item-done`}
              >
                <span className="dot" />
                <div>
                  <Text>任务载入</Text>
                  <Text type="secondary" className="ts">
                    已完成
                  </Text>
                </div>
              </div>
              <div
                className={`native-inspector-timeline-item ${taskDone || task?.running ? "native-inspector-timeline-item-done" : ""}`}
              >
                <span className="dot" />
                <div>
                  <Text>执行 / 审查</Text>
                  <Text type="secondary" className="ts">
                    {taskDone ? "已完成" : task?.running ? "进行中" : "待处理"}
                  </Text>
                </div>
              </div>
              <div
                className={`native-inspector-timeline-item ${taskDone ? "native-inspector-timeline-item-done" : ""}`}
              >
                <span className="dot" />
                <div>
                  <Text>落地校验</Text>
                  <Text type="secondary" className="ts">
                    {taskDone ? "已完成" : "待处理"}
                  </Text>
                </div>
              </div>
            </div>
          </div>

          <div className="inspector-bottom">
            <Button block href={taskHref} onClick={openTask}>
              查看详情
            </Button>

            <div className="native-inspector-footer">
              <div>
                <Text type="secondary">整体进度</Text>
                <Progress
                  percent={progress}
                  status={progress >= 100 ? "success" : "active"}
                />
              </div>
              <div className="native-inspector-footer-row">
                <Text type="secondary">
                  待处理 {filterCount(tasks, "pending", counts)}
                </Text>
                <Text type="secondary">
                  需关注 {filterCount(tasks, "attention", counts)}
                </Text>
              </div>
              {profLabel ? (
                <Text type="secondary" className="native-inspector-profile">
                  Profile: {profLabel}
                </Text>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
      )}
    </Card>
  );
}

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ReactNode;
  /** 有下级时才给折叠箭头。⚠ 见下面 NAV_GROUPS 的注释：不许挂假箭头。 */
  children?: Array<{ id: CapabilityLayer; label: string }>;
}

/*
 * 分组导航（2026-08-26 用户给了样式截图）。
 *
 * ⚠ 用户同一句话里明确否掉了截图里那条**选中项左侧的竖条**
 *   （"菜单项左侧的 border 不要"）。CSS 里也写了一行别加回去——
 *   选中态就是压一层黑，跟 2026-08-20 那次裁决一致。
 *
 * ⚠ 截图里每一项右边都有折叠箭头，**这里只给真的有下级的那一项**。
 *   给「设置」「Dashboard」挂一个展不开的箭头，就是那种"看着能点、点了没
 *   反应"的东西——这个仓刚因为它连着修了两轮（`/` 面板那次）。
 *   2026-09-20：这两项已经不在侧栏，进账号折叠；假箭头纪律仍适用。
 *
 * ## ⚠ 「推演」这一项进出过两次，把两次的理由都记下来
 *
 * 2026-08-26 撤过一次，当时只留品牌 logo `title="回到推演"`——**那次是错的**：
 * 判据写的是 `html.toContain("推演")`，对着 logo 的 title 属性假绿，而新用户
 * 在侧栏里根本找不到产品。2026-08-27 加了回来。
 *
 * 2026-08-28 再撤，用户原话：「顶部的"推演"菜单不要，有底部新建会话与最近的
 * 入口就够了」。**这次跟上次不是同一件事**：那时底下什么都没有，现在
 * `SidebarSessions` 常驻，「新建会话」是一颗实体按钮、「最近」是真的会话列表，
 * 两个都直接进推演。入口从"一条菜单"变成了"一个会话区"，不是消失。
 *
 * ⚠ 所以判据也得跟着换位置：不许再去数 NAV_GROUPS 里有没有 sliderule，
 *   要盯**那个替代入口真的在**（sidebar-session-new / sidebar-session-list）。
 *   只写 `not.toContain("推演")` 就是把上次那个假绿翻了个面——两边都得钉。
 */
export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    /* 2026-09-19：组名不再写「创作资源」。组件库 / 扩展中心从主导航摘掉——
       那是 HTML 工厂货架，装了也不进控制面。应用市场留下（能 Fork 的工程）。
       书签仍走 /agent-loop/skills、/agent-loop/components，页顶标 legacy。 */
    label: "",
    items: [
      { key: "workbench", label: "应用市场", icon: <AppstoreOutlined /> },
      { key: "skills", label: "技能", icon: <ThunderboltOutlined /> },
    ],
  },
];

const NAV_ITEM_TESTID: Partial<Record<ViewKey, string>> = {
  sliderule: "agent-nav-sliderule",
};

/** 书签仍可达、导航已摘掉的旧面。页顶标明不再维护，不 404。
 *  ⚠ 不要把 live `workbench`（应用市场 / AppsWorkbench）算进来——
 *  那一项还在 NAV_GROUPS 里。2026-08-27 第一版把 gallery 也盖了
 *  「legacy，不维护」，侧栏还在卖、点进去却说死了。
 *  2026-09-19：skills / components 从主导航撤下，同样盖这条。 */
export const LEGACY_UNMAINTAINED_VIEWS: readonly ViewKey[] = [
  "workbench-legacy",
  "settings-legacy",
  "components",
];

export function shouldShowLegacyUnmaintainedBanner(view: ViewKey): boolean {
  return (LEGACY_UNMAINTAINED_VIEWS as readonly string[]).includes(view);
}

function SidebarPanelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function AgentLoopSidebar({
  view,
  onViewChange,
  getViewPath,
  capabilityLayer,
  onCapabilityLayer,
}: {
  view: ViewKey;
  onViewChange: (next: ViewKey) => void;
  getViewPath?: (next: ViewKey) => string | undefined;
  capabilityLayer?: CapabilityLayer;
  onCapabilityLayer?: (layer: CapabilityLayer) => void;
}) {
  const shell = useShellSidebar();
  const collapsed = shell?.collapsed ?? false;
  const navGroups = NAV_GROUPS;
  /* 进扩展中心时默认展开三条子项。从 URL 直达 /agent-loop/skills 时
     openKey 若仍是 null，选中了「扩展中心」却看不见技能/连接器/伙伴——
     应用市场、组件库没有这一层，只有这里像少了半截菜单。 */
  const [openKey, setOpenKey] = React.useState<ViewKey | null>(
    view === "skills" ? "skills" : null
  );
  React.useEffect(() => {
    setOpenKey(view === "skills" ? "skills" : null);
  }, [view]);

  return (
    <aside className="native-agent-sidebar">
      {/* 品牌区（可点击 → 推演视图）：面团 AI 横版标识（2026-08-03 用户裁决）。
          此前是「方标 + SlideRule.AI 单行字标」两件拼的。换成横版之后字标就在
          图里，不再单独排一行文字——否则「面团 AI」和「SlideRule.AI」会并排出现。 */}
      <div className="native-agent-brand-row">
        <a
          className="native-agent-brand"
          data-testid="agent-brand"
          href={getViewPath?.("sliderule")}
          title="回到推演"
          onClick={event => {
            if (getViewPath?.("sliderule")) event.preventDefault();
            onViewChange("sliderule");
          }}
        >
          <img
            className="native-agent-brand-logo"
            // BASE_URL 前缀：GitHub Pages 子路径部署（/<repo>/）下绝对路径会 404
            src={`${import.meta.env.BASE_URL}brand/miantuan-horizontal.png`}
            alt="面团 AI"
          />
        </a>
        <button
          type="button"
          className="native-agent-sidebar-toggle"
          data-testid="sidebar-collapse-toggle"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={() => shell?.toggle()}
        >
          <SidebarPanelIcon />
        </button>
      </div>
      <nav className="native-agent-nav" aria-label={BRAND_NAME_FULL}>
        {navGroups.filter(g => g.items.length > 0).map(group => (
          <div className="native-agent-nav-group" key={group.label}>
            {group.label ? (
              <div className="native-agent-nav-group-label">{group.label}</div>
            ) : null}
            {group.items.map(item => {
              const active = view === item.key;
              const expanded = openKey === item.key;
              return (
                <React.Fragment key={item.key}>
                  <a
                    href={getViewPath?.(item.key)}
                    className={`native-agent-nav-item${active ? " native-agent-nav-item-active" : ""}`}
                    title={item.label}
                    data-testid={NAV_ITEM_TESTID[item.key]}
                    onClick={event => {
                      if (getViewPath?.(item.key)) event.preventDefault();
                      onViewChange(item.key);
                      /* ⚠ 整行都要能开合。上一版 `setOpenKey(item.key)` 只会展开，
                         展开后再点标签等于没点——只能去点那颗 18px 箭头才收得起来。 */
                      if (item.children) {
                        setOpenKey(prev => (prev === item.key ? null : item.key));
                      }
                    }}
                  >
                    {item.icon}
                    <span className="native-agent-rail-copy">{item.label}</span>
                    {item.children ? (
                      <button
                        type="button"
                        aria-label={expanded ? "收起" : "展开"}
                        aria-expanded={expanded}
                        data-testid="agent-nav-expand"
                        className="native-agent-nav-caret"
                        onClick={event => {
                          // 箭头只管展开/收起，不跟着跳页
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenKey(prev =>
                            prev === item.key ? null : item.key
                          );
                        }}
                      >
                        <DownOutlined
                          className={expanded ? "is-open" : undefined}
                        />
                      </button>
                    ) : null}
                  </a>
                  {item.children && expanded
                    ? item.children.map(sub => (
                        <button
                          type="button"
                          key={sub.id}
                          data-testid="agent-nav-subitem"
                          data-layer={sub.id}
                          className={`native-agent-nav-subitem${
                            active && capabilityLayer === sub.id
                              ? " native-agent-nav-subitem-active"
                              : ""
                          }`}
                          onClick={() => {
                            onCapabilityLayer?.(sub.id);
                            onViewChange(item.key);
                          }}
                        >
                          {sub.label}
                        </button>
                      ))
                    : null}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </nav>
      {/* 会话区。Pages 纯浏览器演示是单会话（无后端会话库），提供本地
          「新建会话」：清空演示存档并回到预填意图的初始体验。 */}
      {IS_GITHUB_PAGES ? (
        <div className="native-agent-sessions" data-testid="sidebar-sessions">
          <button
            type="button"
            className="native-agent-session-new"
            data-testid="sidebar-demo-new-session"
            title="新建会话"
            onClick={() => {
              try {
                const doomed: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && k.startsWith("sliderule:github-pages-demo:")) {
                    doomed.push(k);
                  }
                }
                doomed.forEach(k => localStorage.removeItem(k));
              } catch {
                /* 隐私模式下无存档可清 */
              }
              // 整页跳回推演演示入口（带 Pages base 前缀）——不能原地 reload：
              // 从技能库/设置等其他视图点「新建会话」时会留在当前视图回不去。
              const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
              const path = getViewPath?.("sliderule") || "/agent-loop/sliderule";
              window.location.href = base + path;
            }}
          >
            <span className="native-agent-session-new-plus">+</span>
            <span className="native-agent-rail-copy">新建会话</span>
          </button>
          <div className="native-agent-sessions-label">最近</div>
          <div className="native-agent-sessions-list">
            <div className="native-agent-sessions-hint">
              静态演示为单会话 · 完整版支持多会话并行
            </div>
          </div>
        </div>
      ) : (
        <SidebarSessions
          onOpenSliderule={() => onViewChange("sliderule")}
          onOpenWorkbench={() => onViewChange("workbench")}
        />
      )}
      {/* 2026-09-20：底栏只留账号触发行。设置 / Dashboard / 帮助进折叠菜单
          （对照 Cursor）。2026-08-18 那行帮助文档撤了——菜单接手，见 AccountPanel。 */}
      <div className="native-agent-footer">
        <AccountPanel
          onOpenView={next => onViewChange(next)}
        />
      </div>
    </aside>
  );
}

function AgentLoopTopbar({
  view,
  showActions = true,
  pythonHealth,
}: {
  view: ViewKey;
  showActions?: boolean;
  pythonHealth?: PythonHealthViewModel | null;
}) {
  // 品牌统一：系统对外叫面团 AI（2026-08-03 换名，此前是 SlideRule），顶栏不再
  // 出现 AgentLoop（内部路由/标识保留，不破链接）
  const title =
    view === "sliderule"
      ? "面团 / 推演"
      : view === "settings"
        ? "面团 / 设置"
        : view === "dashboard" || view === "admin"
          ? "面团 / Dashboard"
        : view === "settings-legacy"
          ? "面团 / 设置（legacy）"
          : view === "skills"
            ? "面团 / 技能"
            : view === "components"
              ? "面团 / 组件库"
            : view === "help"
              ? "面团 / 帮助"
              : view === "workbench-legacy"
              ? "面团 / 任务队列（legacy）"
              : "面团 / 应用市场";

  const pythonStatus = pythonHealth?.service?.status || "unknown";
  const pythonTone =
    pythonStatus === "ready"
      ? "success"
      : pythonStatus === "offline"
        ? "error"
        : "warning";
  const pythonLabel = pythonHealth?.service?.label || "Python health";

  return (
    <Header
      className="native-header native-agent-topbar"
      style={{
        // 走同一个壳底色变量，不写死——写死的话顶栏会盖过 CSS 里的 token，
        // 换底色时只有它一条留在原地（灰顶栏 + 白内容）。
        background: "var(--sr-shell-bg, #f4f4f6)",
        borderBottom: "none",
        boxShadow: "none",
      }}
    >
      <div className="native-topbar-left">
        <span className="native-topbar-brand">{title}</span>
      </div>
      {showActions ? (
        <Space size="small" className="native-agent-topbar-actions">
          <Tag color={pythonTone}>{pythonLabel}</Tag>
          <span className="native-topbar-link">本地 Web 预览</span>
          <span className="native-topbar-link">刷新预览</span>
          <span className="native-topbar-runtime">
            Python API • SlideRule runtime
          </span>
          <Button
            type="primary"
            icon={<PlayCircleFilled />}
            onClick={() => postCommand("runQueue")}
          >
            运行队列
          </Button>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => postCommand("refresh")}
            aria-label="刷新"
          />
        </Space>
      ) : null}
    </Header>
  );
}

/**
 * 对外的 DashboardApp：套一层 AuthProvider。
 *
 * 登录态要全站一份（应用中心一屏几十张卡都要知道"我能不能改这个"），
 * 所以放在最外层而不是各处自己 fetch。见 lib/use-auth 的说明。
 */
export function DashboardApp(props: React.ComponentProps<typeof DashboardAppInner>) {
  return (
    <AuthProvider>
      <ShellSidebarProvider>
        <DashboardAppInner {...props} />
      </ShellSidebarProvider>
    </AuthProvider>
  );
}

function DashboardAppInner({
  payload,
  initialView = "workbench" as ViewKey,
  view: controlledView,
  onViewChange,
  getViewPath,
  getTaskRunPath,
  onOpenTask,
}: {
  payload: OverviewPayload;
  initialView?: ViewKey;
  view?: ViewKey;
  onViewChange?: (next: ViewKey) => void;
  getViewPath?: (next: ViewKey) => string | undefined;
  getTaskRunPath?: (runId: string) => string;
  onOpenTask?: (taskPath: string, runId?: string | null) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [internalView, setInternalView] = useState<ViewKey>(initialView);
  const view = controlledView ?? internalView;
  const [settingsData, setSettingsData] =
    useState<AgentLoopSettingsViewModel | null>(null);
  const [providerTests, setProviderTests] = useState<any[]>([]);
  const [workerCliTests, setWorkerCliTests] = useState<any[]>([]);
  const [queueDefaultsData, setQueueDefaultsData] = useState<any>(null);
  const [queuePreview, setQueuePreview] = useState<any>(null);
  const [queueApply, setQueueApply] = useState<any>(null);
  const [exportedSettings, setExportedSettings] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const shellSidebar = useShellSidebar();
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [pythonHealth, setPythonHealth] = useState<any>(null);
  const [profilesData, setProfilesData] = useState<any>(null);

  // Python backend failure visible + retry/fallback/status for AgentLoop core (105)
  const [pyError, setPyError] = useState<any>(null);
  const [pyMsg, setPyMsg] = useState<string>("");

  const tasks = payload.tasks || [];
  const visibleTasks = useMemo(
    () => filterTasks(tasks, filter, query),
    [tasks, filter, query]
  );
  const inspectorTask =
    visibleTasks[0] || queueTasks(tasks)[0] || tasks[0] || null;
  const tabItems = CATEGORY_ORDER.map(key => ({
    key,
    label: `${FILTER_LABELS[key]} ${filterCount(tasks, key, payload.counts)}`,
  }));

  // Load settings only for task/config surfaces. The embedded SlideRule surface should not touch
  // AgentLoop settings or queue endpoints until the user opens workbench/settings.
  // getQueueDefaults etc remain lazy until settings tab per prior design.
  useEffect(() => {
    if (shouldRequestSettingsForView(view)) {
      postCommand("getSettings");
    }
  }, [view]);

  // 浏览器标签标题：推演页由会话话题驱动（SlideRule 内部 effect），其余视图按视图名
  useEffect(() => {
    if (view === "sliderule") return;
    const label =
      view === "workbench"
        ? "应用市场"
        : view === "skills"
          ? "技能"
          : view === "components"
            ? "组件库"
          : view === "settings"
            ? "设置"
            : view === "dashboard" || view === "admin"
              ? "Dashboard"
            : view === "help"
              ? "帮助"
            : view === "settings-legacy"
              ? "设置（legacy）"
              : "任务队列（legacy）";
    document.title = `${label} · ${BRAND_NAME_FULL}`;
  }, [view]);

  // Load additional settings-tab data when switching to the legacy settings view
  useEffect(() => {
    if (view === "settings-legacy") {
      postCommand("getQueueDefaults");
      postCommand("getDiagnostics");
      postCommand("listProfiles");
    }
  }, [view]);

  useEffect(() => {
    // GitHub Pages 静态演示无 Python 后端：健康探测必 404，直接跳过
    // （对应的健康状态 UI 在 Pages 下也不渲染）。
    if (IS_GITHUB_PAGES) return;
    let alive = true;
    fetchPythonHealth()
      .then(health => {
        if (alive) setPythonHealth(normalizePythonHealthViewModel(health));
      })
      .catch(() => {
        if (alive)
          setPythonHealth(
            normalizePythonHealthViewModel({
              status: "degraded",
              message: "Python health probe failed",
            })
          );
      });
    return () => {
      alive = false;
    };
  }, [view]);

  // Probe + status/retry for Python backend failures visible (105); keep Node as thin proxy
  const probeAgentLoopPython = useCallback(async () => {
    if (IS_GITHUB_PAGES) return;
    try {
      const r = await fetchJsonSafe<any>("/api/agent-loop/health");
      if (
        !r.ok &&
        (isPythonBackendFailure(r.error) || isDegradedApiError(r.error))
      ) {
        setPyError(r.error);
        setPyMsg(
          `Python backend ${r.error.kind}${r.error.status ? " " + r.error.status : ""}: ${r.error.message}`
        );
      } else {
        setPyError(null);
        setPyMsg("");
      }
    } catch {
      setPyError({ kind: "degraded", message: "unreachable", retryable: true });
      setPyMsg("Python timeout/degraded");
    }
  }, []);
  useEffect(() => {
    probeAgentLoopPython();
  }, [probeAgentLoopPython]);
  const retryAgentLoopPython = useCallback(() => {
    setPyMsg("retrying Python...");
    probeAgentLoopPython();
  }, [probeAgentLoopPython]);

  // Receive settings from extension (or mock in dev)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === "settings") {
        setSettingsData(msg.payload);
      }
      if (msg?.type === "saveBlocked" && msg.payload) {
        message.warning(msg.payload.message || "操作被阻止（队列运行中）");
      }
      if (msg?.type === "providerHealth" && msg.payload) {
        setProviderTests(prev => {
          const filtered = prev.filter(
            (p: any) => p.provider !== msg.payload.provider
          );
          return [...filtered, msg.payload];
        });
      }
      if (msg?.type === "workerCliHealth" && msg.payload) {
        setWorkerCliTests(prev => {
          const filtered = prev.filter(
            (p: any) => p.worker !== msg.payload.worker
          );
          return [...filtered, msg.payload];
        });
      }
      if (msg?.type === "queueDefaults" && msg.payload) {
        setQueueDefaultsData(msg.payload);
      }
      if (msg?.type === "queuePreview" && msg.payload) {
        setQueuePreview(msg.payload);
      }
      if (msg?.type === "queueApply" && msg.payload) {
        setQueueApply(msg.payload);
      }
      if (msg?.type === "settingsExported" && msg.payload) {
        setExportedSettings(msg.payload);
      }
      if (msg?.type === "importSettingsResult" && msg.payload) {
        setImportResult(msg.payload);
        if (msg.payload.ok) {
          postCommand("getSettings");
        }
      }
      if (msg?.type === "diagnostics" && msg.payload) {
        setDiagnosticsData(msg.payload);
      }
      if (msg?.type === "profiles" && msg.payload) {
        setProfilesData(msg.payload);
      }
      if (msg?.type === "profileError" && msg.payload) {
        message.error(msg.payload.error || "profile op failed");
      }
      if (msg?.type === "cancelResult" && msg.payload) {
        const r = msg.payload;
        if (r && r.status === "queued-cancel") {
          // Explicit UI copy: queued/advisory cancel from bridge is not a real process kill.
          message.warning(
            r.message ||
              "取消为 queued-cancel 占位（bridge 不支持进程终止，非真实停止）"
          );
        } else if (r && r.status === "error") {
          message.error(r.message || "取消请求失败");
        }
        // Other/future real cancel statuses: forward-compatible, no misleading stop-success UI.
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleSaveSettings = (values: Record<string, unknown>) => {
    postCommand("saveSettings", values);
  };

  const handlePreviewQueueDefaults = (proposed: Record<string, unknown>) => {
    setQueuePreview(null);
    setQueueApply(null);
    postCommand("previewQueueDefaults", { proposed });
  };

  const handleApplyQueueDefaults = (proposed: Record<string, unknown>) => {
    setQueueApply(null);
    postCommand("applyQueueDefaults", { proposed });
  };

  const handleExportSettings = () => {
    setExportedSettings(null);
    setImportResult(null);
    postCommand("exportSettings");
  };

  const handleImportSettings = (text: string) => {
    setImportResult(null);
    let parsed: any;
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      setImportResult({ ok: false, error: "malformed JSON" });
      return;
    }
    postCommand("importSettings", parsed);
  };

  const handleListProfiles = () => {
    postCommand("listProfiles");
  };

  const handleCreateProfile = (
    name: string,
    values?: Record<string, unknown>
  ) => {
    postCommand("createProfile", { name, values: values || {} });
  };

  const handleRenameProfile = (oldName: string, newName: string) => {
    postCommand("renameProfile", { oldName, newName });
  };

  const handleDuplicateProfile = (name: string, newName: string) => {
    postCommand("duplicateProfile", { name, newName });
  };

  const handleDeleteProfile = (name: string) => {
    postCommand("deleteProfile", { name });
  };

  const handleSelectProfile = (name: string) => {
    postCommand("selectProfile", { name });
  };

  /* 「扩展中心」当前停在哪一层。侧栏展开的三条子项直接切它。
     ⚠ 状态放在这里而不是页面里：侧栏和页面是两个组件，页面自己存的话
       侧栏点了没反应（页面已经挂着，initialLayer 只在首次渲染生效）。
       所以下面渲染时还带了 key={capabilityLayer} 强制重挂。 */
  const [capabilityLayer, setCapabilityLayer] =
    React.useState<CapabilityLayer>("skills");

  const handleViewChange = (next: ViewKey) => {
    if (controlledView === undefined) {
      setInternalView(next);
    }
    onViewChange?.(next);
  };

  const workbenchContent = (
    <div className="native-workbench-shell">
      <OverviewHeader payload={payload} settings={settingsData} />
      {/* Python error/timeout/degraded visible + retry/status messaging (105 req2); legacy fallback not silent */}
      {(pyError || pyMsg) && (
        <Alert
          type="warning"
          showIcon
          style={{ margin: "8px 0" }}
          message="Python backend status"
          description={
            <span>
              {pyMsg}{" "}
              <a onClick={retryAgentLoopPython} style={{ cursor: "pointer" }}>
                retry
              </a>{" "}
              {isDegradedApiError(pyError) ? "(degraded envelope)" : ""}{" "}
              {isPythonBackendFailure(pyError) ? "· visible, not hidden" : ""}
            </span>
          }
        />
      )}
      <SummaryStats payload={payload} />
      <Row gutter={[12, 12]} align="stretch" className="native-workbench-grid">
        <Col xs={24} xl={17} xxl={18}>
          <Card className="native-task-table-card" variant="borderless">
            <div className="native-table-toolbar">
              <div className="native-table-toolbar-copy">
                <Title level={4}>任务列表</Title>
              </div>
              <Space wrap size="small" className="native-table-toolbar-actions">
                <Input.Search
                  placeholder="搜索任务、分支或文件名"
                  allowClear
                  onChange={event => setQuery(event.target.value)}
                />
                <Button icon={<SnippetsOutlined />}>筛选</Button>
                <Button icon={<SettingOutlined />} aria-label="表格设置" />
              </Space>
            </div>
            <div className="native-filter-pills">
              {tabItems.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={`native-filter-pill ${filter === item.key ? "active" : ""}`}
                  onClick={() => setFilter(item.key as FilterKey)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <QueueTable
              tasks={visibleTasks}
              getTaskRunPath={getTaskRunPath}
              onOpenTask={onOpenTask}
            />
          </Card>
        </Col>
        <Col xs={24} xl={7} xxl={6}>
          <TaskInspector
            payload={payload}
            settings={settingsData}
            task={inspectorTask}
            getTaskRunPath={getTaskRunPath}
            onOpenTask={onOpenTask}
          />
        </Col>
      </Row>
    </div>
  );

  const slideruleContent = (
    <div className="native-workbench-shell native-sliderule-workbench">
      <section className="native-sliderule-shell" aria-label="面团 推演">
        <SlideRulePage embedded />
      </section>
    </div>
  );

  const settingsContent = (
    <SettingsView
      data={settingsData}
      onSave={handleSaveSettings}
      providerTests={providerTests}
      onTestProvider={provider => postCommand("testProvider", { provider })}
      workerCliTests={workerCliTests}
      onTestWorkerCli={w => postCommand("testWorkerCli", { worker: w })}
      queueDefaultsData={queueDefaultsData}
      queuePreview={queuePreview}
      onPreviewQueue={handlePreviewQueueDefaults}
      queueApply={queueApply}
      onApplyQueue={handleApplyQueueDefaults}
      exportedSettings={exportedSettings}
      importResult={importResult}
      onExportSettings={handleExportSettings}
      onImportSettings={handleImportSettings}
      diagnosticsData={diagnosticsData}
      onRefreshDiagnostics={() => postCommand("getDiagnostics")}
      pythonHealth={pythonHealth}
      profilesData={profilesData}
      onListProfiles={handleListProfiles}
      onCreateProfile={handleCreateProfile}
      onRenameProfile={handleRenameProfile}
      onDuplicateProfile={handleDuplicateProfile}
      onDeleteProfile={handleDeleteProfile}
      onSelectProfile={handleSelectProfile}
    />
  );

  const contentClassName = [
    "native-content",
    view === "settings-legacy"
      ? "native-settings-content"
      : "native-workbench-content",
    view === "sliderule" ? "native-sliderule-content" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ConfigProvider
      prefixCls="agent-ant"
      csp={
        typeof window !== "undefined" && window.__AGENT_LOOP_CSP_NONCE__
          ? { nonce: window.__AGENT_LOOP_CSP_NONCE__ }
          : undefined
      }
    >
      <Layout
        className="native-dashboard native-agent-shell"
        data-sidebar-collapsed={shellSidebar?.collapsed ? "true" : "false"}
      >
        <AgentLoopSidebar
          view={view}
          onViewChange={handleViewChange}
          getViewPath={getViewPath}
          capabilityLayer={capabilityLayer}
          onCapabilityLayer={setCapabilityLayer}
        />
        <Layout className="native-main native-agent-main">
          {/* 顶栏/面包屑整段移除（用户裁决）：应用中心等页自带标题，推演页有 HUD；
              legacy 任务队列若仍需「运行队列」等操作，走页面内按钮而非全局 header。 */}
          <Content className={contentClassName}>
            {shouldShowLegacyUnmaintainedBanner(view) ? (
              <LegacyUnmaintainedBanner />
            ) : null}
            {view === "workbench" ? (
              <AppsWorkbench />
            ) : view === "workbench-legacy" ? (
              // 观察台退役进 legacy（用户裁决 2026-07-15）：跟任务队列
              // 驾驶舱做伴，URL 直达仍可用；产品面只剩画廊 + 健康浮层
              <>
                <MainlineWorkbench />
                {workbenchContent}
              </>
            ) : view === "sliderule" ? (
              slideruleContent
            ) : view === "help" ? (
              <React.Suspense
                fallback={
                  <div style={{ padding: 24, fontSize: 12, color: "#999" }}>
                    帮助文档加载中…
                  </div>
                }
              >
                <LazyHelpCenterPage />
              </React.Suspense>
            ) : view === "skills" ? (
              <React.Suspense
                fallback={
                  <div style={{ padding: 24, fontSize: 12, color: "#999" }}>
                    技能商店加载中…
                  </div>
                }
              >
                <LazySkillStorePage />
              </React.Suspense>
            ) : view === "components" ? (
              <React.Suspense
                fallback={
                  <div style={{ padding: 24, fontSize: 12, color: "#999" }}>
                    组件库加载中…
                  </div>
                }
              >
                <LazyComponentsLibraryPage />
              </React.Suspense>
            ) : view === "settings" ? (
              <SettingsPage />
            ) : view === "dashboard" || view === "admin" ? (
              <AccountDashboardPage />
            ) : (
              settingsContent
            )}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

// Re-exports for test contract (agentloop setting * 112 tests directly import sub components from DashboardApp).
// Real impl lives in ./settings/* focused modules per component split task.
export { CliConfigForm } from "./settings/CliConfigPanel";
export { QueueDefaultsView } from "./settings/QueueDefaultsPanel";
export { ProfileCrudView } from "./settings/ProfilesPanel";
export { default as SettingsView } from "./settings/SettingsView";

// Local compat type kept only for any residual references (delegated to settings modules).
type SettingsData = Partial<AgentLoopSettingsViewModel> & {
  nonSensitive?: {
    fixAgent?: string;
    reviewAgent?: string;
    workerMaxTurns?: number;
    workerMaxRetries?: number;
    queuePath?: string;
    worktreeScope?: string;
  };
};

// Legacy LlmKeyForm kept as internal for now; the primary Llm keys panel is in settings/LlmKeysPanel (rendered via SettingsView).
function LlmKeyForm({
  initial,
  onSave,
  providerTests,
  onTestProvider,
  workerCliTests,
  onTestWorkerCli,
  queueRunning,
}: {
  initial: SettingsData;
  onSave: (v: any) => void;
  providerTests?: any[];
  onTestProvider?: (p: string) => void;
  workerCliTests?: any[];
  onTestWorkerCli?: (w: string) => void;
  queueRunning?: boolean;
}) {
  const [form] = Form.useForm();
  const isRunning = Boolean(queueRunning);
  const baseUrlLocked = isRunning; // baseUrl is runtime-locked per guard

  useEffect(() => {
    if (initial) {
      form.setFieldsValue({
        baseUrl: initial.baseUrl || "",
        injectToWorker: initial.injectToWorker !== false,
      });
    }
  }, [initial, form]);

  const getKeyStatus = (key?: string) =>
    key === "configured" ? (
      <Tag color="success">已配置 (redacted)</Tag>
    ) : (
      <Tag>未配置</Tag>
    );

  const handleFinish = (values: any) => {
    // Never include secret key values: /settings only persists non-secrets; UI must not report false success for keys
    const payload: any = {
      baseUrl: values.baseUrl,
      injectToWorker: values.injectToWorker,
    };
    const hadKeyAttempt = !!(
      values.grokApiKey ||
      values.openaiApiKey ||
      values.anthropicApiKey
    );

    onSave(payload);
    if (hadKeyAttempt) {
      message.warning(
        "LLM key 值未持久化（此 web 切片仅 /settings 非秘密后端）；不报告保存成功。"
      );
    } else {
      message.success("配置已保存");
    }
    // clear password fields after save for security feel
    form.setFieldsValue({
      grokApiKey: "",
      openaiApiKey: "",
      anthropicApiKey: "",
    });
  };

  const handleClear = (keyName: string) => {
    // Block secret clear/save: do not forward to nonsecret backend; do not report persisted success/cleared
    if (["grokApiKey", "openaiApiKey", "anthropicApiKey"].includes(keyName)) {
      message.warning(
        "LLM key 清除在此 web 切片中不支持（无持久化）；仅显示 configured 状态。"
      );
      form.setFieldsValue({ [keyName]: "" });
      return;
    }
    const payload: any = { [keyName]: "" };
    onSave(payload);
    message.success("已清除");
  };

  const handleTest = (provider: string) => {
    if (onTestProvider) {
      onTestProvider(provider);
    }
  };

  const getTestResult = (provider: string) => {
    return (providerTests || []).find((r: any) => r.provider === provider);
  };

  const renderResult = (provider: string) => {
    const r = getTestResult(provider);
    if (!r) return null;
    const tone =
      r.status === "ok"
        ? "success"
        : r.status === "skipped"
          ? "default"
          : "error";
    let timeStr = "";
    try {
      if (r.checkedAt)
        timeStr = " " + new Date(r.checkedAt).toLocaleTimeString();
    } catch {}
    return (
      <div style={{ marginTop: 4, fontSize: 12 }}>
        <Tag color={tone}>{r.status}</Tag>
        <span>
          {r.durationMs}ms · {r.reason}
          {timeStr} (cached)
        </span>
      </div>
    );
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleFinish}
      style={{ maxWidth: 620 }}
    >
      <Alert
        type="warning"
        showIcon
        message="LLM Keys 保存/清除在此 web 切片不支持（/settings 为 non-secret 后端）；仅显示状态，持久化操作被阻断。"
        style={{ marginBottom: 12 }}
      />
      <Form.Item label="Grok API Key / Token">
        <Space>
          {getKeyStatus(initial?.keys?.grokApiKey)}
          <Button
            size="small"
            danger
            disabled
            title="LLM key 持久化/清除在此 web 切片不支持"
          >
            清除
          </Button>
          <Button size="small" onClick={() => handleTest("grok")}>
            测试
          </Button>
        </Space>
        <Form.Item name="grokApiKey" noStyle>
          <Input.Password
            placeholder="（此 web 切片不支持输入保存）"
            disabled
          />
        </Form.Item>
        {renderResult("grok")}
      </Form.Item>

      <Form.Item label="OpenAI API Key">
        <Space>
          {getKeyStatus(initial?.keys?.openaiApiKey)}
          <Button
            size="small"
            danger
            disabled
            title="LLM key 持久化/清除在此 web 切片不支持"
          >
            清除
          </Button>
          <Button size="small" onClick={() => handleTest("openai")}>
            测试
          </Button>
        </Space>
        <Form.Item name="openaiApiKey" noStyle>
          <Input.Password
            placeholder="（此 web 切片不支持输入保存）"
            disabled
          />
        </Form.Item>
        {renderResult("openai")}
      </Form.Item>

      <Form.Item label="Anthropic API Key">
        <Space>
          {getKeyStatus(initial?.keys?.anthropicApiKey)}
          <Button
            size="small"
            danger
            disabled
            title="LLM key 持久化/清除在此 web 切片不支持"
          >
            清除
          </Button>
          <Button size="small" onClick={() => handleTest("anthropic")}>
            测试
          </Button>
        </Space>
        <Form.Item name="anthropicApiKey" noStyle>
          <Input.Password
            placeholder="（此 web 切片不支持输入保存）"
            disabled
          />
        </Form.Item>
        {renderResult("anthropic")}
      </Form.Item>

      <Form.Item label="Worker CLI 健康 (本地 grok/codex 命令探针)">
        <Space>
          <Button
            size="small"
            onClick={() => onTestWorkerCli && onTestWorkerCli("grok")}
          >
            Probe grok
          </Button>
          <Button
            size="small"
            onClick={() => onTestWorkerCli && onTestWorkerCli("codex")}
          >
            Probe codex
          </Button>
        </Space>
        {(() => {
          const gr = (workerCliTests || []).find(
            (r: any) => r.worker === "grok"
          );
          const cr = (workerCliTests || []).find(
            (r: any) => r.worker === "codex"
          );
          const tone = (st: string) =>
            st === "ok"
              ? "success"
              : st === "skipped"
                ? "default"
                : st === "timeout"
                  ? "warning"
                  : "error";
          return (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {gr && (
                <div>
                  <Tag color={tone(gr.status)}>{gr.worker}</Tag> {gr.status}{" "}
                  {gr.durationMs}ms · {gr.reason}
                </div>
              )}
              {cr && (
                <div>
                  <Tag color={tone(cr.status)}>{cr.worker}</Tag> {cr.status}{" "}
                  {cr.durationMs}ms · {cr.reason}
                </div>
              )}
            </div>
          );
        })()}
      </Form.Item>

      <Form.Item label="代理地址 / Base URL" name="baseUrl">
        <Input
          placeholder="https://api.example.com/v1"
          disabled={baseUrlLocked}
        />
      </Form.Item>

      <Form.Item
        label="将 Keys 注入到 Worker 环境"
        name="injectToWorker"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">
            保存非秘密设置
          </Button>
          <Button
            danger
            onClick={async () => {
              // Do not pass key empties (would be stripped anyway); do not report secret clear success
              await onSave({
                baseUrl: form.getFieldValue("baseUrl"),
                injectToWorker: form.getFieldValue("injectToWorker"),
              });
              message.warning(
                "LLM keys 清除不支持（web /settings 切片无秘密持久化能力）；仅状态显示。"
              );
              form.setFieldsValue({
                grokApiKey: "",
                openaiApiKey: "",
                anthropicApiKey: "",
              });
            }}
          >
            清除全部 Keys
          </Button>
        </Space>
      </Form.Item>

      <Text type="secondary" style={{ fontSize: 12 }}>
        此 web 切片仅显示 LLM key configured 状态（来自
        /settings）；保存/清除持久化不受支持。点击“测试”触发 provider health
        check。
      </Text>

      {providerTests && providerTests.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: "#fafafa",
            border: "1px solid #eee",
          }}
        >
          <Text strong style={{ fontSize: 12 }}>
            最近 Provider 健康检查 (会话缓存)
          </Text>
          {providerTests.map((r: any, idx: number) => (
            <div key={idx} style={{ fontSize: 12, marginTop: 2 }}>
              {r.provider} · {r.status} · {r.durationMs}ms · {r.reason}{" "}
              {r.checkedAt
                ? "@" + new Date(r.checkedAt).toLocaleTimeString()
                : ""}{" "}
              (cached)
            </div>
          ))}
        </div>
      )}
    </Form>
  );
}

// Old inline SettingsView/QueueDefaultsView/DiagnosticsView/ProfileCrudView removed.
// Delegated to ./settings/* (SettingsView, *Panel modules). Re-exports above preserve render + test contracts.

// (settings panels extracted)

type FlowNodeState = "done" | "active" | "wait" | "halt";
type FlowNodeTone = "blue" | "green" | "purple";
type FlowNode = {
  id: string;
  title: string;
  subtitle: string;
  state: FlowNodeState;
  tone: FlowNodeTone;
};

type G6FlowData = {
  nodes: Array<{ id: string; style: Record<string, unknown> }>;
  edges: Array<Record<string, unknown>>;
};

const FLOW_WIDTH = 950;
const FLOW_HEIGHT = 126;
const FLOW_NODE_WIDTH = 136;
const FLOW_NODE_HEIGHT = 58;

const FLOW_NODE_TONES: Record<
  FlowNodeTone,
  { fill: string; stroke: string; label: string; badge: string }
> = {
  blue: {
    fill: "#f7fbff",
    stroke: "#cfe0f8",
    label: "#1d4f8f",
    badge: "#2f7dff",
  },
  green: {
    fill: "#f3fff6",
    stroke: "#9be6aa",
    label: "#166534",
    badge: "#22b14c",
  },
  purple: {
    fill: "#fbf8ff",
    stroke: "#c9a7ff",
    label: "#5b32a3",
    badge: "#7b61d1",
  },
};

function flowNodeToneStyle(node: FlowNode): Record<string, unknown> {
  const tone = FLOW_NODE_TONES[node.tone];
  const isActive = node.state === "active";
  const isHalt = node.state === "halt";
  return {
    fill: isHalt ? "#fff7f6" : tone.fill,
    stroke: isHalt ? "#ff7875" : isActive ? "#2474ee" : tone.stroke,
    lineWidth: isActive ? 1.8 : 1,
    radius: 8,
    shadowBlur: isActive ? 10 : 8,
    shadowColor: isActive
      ? "rgba(36, 116, 238, 0.18)"
      : "rgba(36, 116, 238, 0.08)",
    labelFill: isHalt ? "#cf1322" : tone.label,
    badgeBackgroundFill: isHalt
      ? "#ff4d4f"
      : node.state === "wait"
        ? "#a9b9cc"
        : tone.badge,
  };
}

function productStageState(status: string | null | undefined): {
  index: number;
  done?: boolean;
  halt?: boolean;
} {
  const value = String(status || "");
  if (value.startsWith("DONE_") || value === "MANUAL_RESCUE_LANDED")
    return { index: 5, done: true };
  if (value === "HALT_NO_SUCCESS_CRITERIA") return { index: 0, halt: true };
  if (value.startsWith("HALT_") || value === "STALE_INTERRUPTED") {
    return { index: value.includes("REVIEW") ? 4 : 2, halt: true };
  }
  if (
    value === "INIT" ||
    value === "PROBED" ||
    value === "RESUMED" ||
    value === "WORKTREE_READY"
  )
    return { index: 0 };
  if (value === "BASELINE_GATE_RESULT") return { index: 1 };
  if (value === "POST_FIX_GATE_RESULT") return { index: 3 };
  if (value.endsWith("_REVIEW")) return { index: 4 };
  if (
    value.endsWith("_FIX") ||
    value === "BUDGET_LOOP_HEAD" ||
    value === "REVIEW_NEEDS_CHANGES"
  )
    return { index: 2 };
  return { index: 0 };
}

function buildFlowNodes(payload: DetailPayload): FlowNode[] {
  const worker = titleCaseAgent(payload.fixAgent || "grok", "Grok");
  const reviewer = titleCaseAgent(payload.reviewAgent || "codex", "Codex");
  const state = productStageState(payload.status);
  return [
    {
      id: "admission",
      title: "任务准入",
      subtitle: "条件检查",
      state: flowNodeState(0, state),
      tone: "blue",
    },
    {
      id: "baseline",
      title: "基线 Gate",
      subtitle: "环境约束",
      state: flowNodeState(1, state),
      tone: "blue",
    },
    {
      id: "worker",
      title: `Worker (${worker})`,
      subtitle: "修复代码",
      state: flowNodeState(2, state),
      tone: "blue",
    },
    {
      id: "fix-gate",
      title: "修复 Gate",
      subtitle: "验证测试",
      state: flowNodeState(3, state),
      tone: "blue",
    },
    {
      id: "reviewer",
      title: `Reviewer (${reviewer})`,
      subtitle: "复查验收",
      state: flowNodeState(4, state),
      tone: "purple",
    },
    {
      id: "delivered",
      title: "已交付",
      subtitle: "可合并",
      state: flowNodeState(5, state),
      tone: "green",
    },
  ];
}

function flowNodeState(
  index: number,
  state: { index: number; done?: boolean; halt?: boolean }
): FlowNodeState {
  if (state.done || index < state.index) return "done";
  if (index === state.index) return state.halt ? "halt" : "active";
  return "wait";
}

function buildG6FlowData(
  nodes: FlowNode[],
  width: number = FLOW_WIDTH
): G6FlowData {
  // Spread nodes more: larger step for dispersion, modest side padding + centering.
  // Caps max step so gaps don't become excessive on very wide screens.
  const sidePadding = 36;
  const usable = Math.max(620, width - sidePadding * 2);
  const step = Math.min(185, Math.max(158, usable / 5));
  const chainWidth = step * 5;
  const startX = sidePadding + Math.max(0, (usable - chainWidth) / 2);
  const nodeY = 42;

  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      style: {
        ...flowNodeToneStyle(node),
        x: startX + index * step,
        y: nodeY,
        size: [FLOW_NODE_WIDTH, FLOW_NODE_HEIGHT],
        label: true,
        labelText: `${node.title}\n${node.subtitle}`,
        labelPlacement: "center",
        labelTextAlign: "center",
        labelTextBaseline: "middle",
        labelWordWrap: false,
        labelMaxWidth: FLOW_NODE_WIDTH - 18,
        labelFontSize: 12,
        labelFontWeight: 700,
        labelLineHeight: 16,
        badge: true,
        badges: [
          {
            text:
              node.state === "done"
                ? "✓"
                : node.state === "active"
                  ? "▶"
                  : node.state === "halt"
                    ? "!"
                    : String(index + 1),
            placement: "right-top",
            offsetX: -5,
            offsetY: 5,
          },
        ],
        badgeFill: "#fff",
        badgeFontSize: 10,
        badgeFontWeight: 800,
        badgeBackgroundRadius: 999,
        badgePadding: [3, 5, 3, 5],
        port: true,
        ports: [
          { key: "left", placement: "left", r: 0 },
          { key: "right", placement: "right", r: 0 },
          { key: "bottom", placement: "bottom", r: 0 },
        ],
      },
    })),
    edges: [
      ...nodes.slice(0, -1).map((node, index) => ({
        id: `main-${index}`,
        source: nodes[index].id,
        target: nodes[index + 1].id,
        type: "line",
        style: {
          lineWidth: 3,
          stroke: "#22b14c",
          sourcePort: "right",
          targetPort: "left",
          zIndex: 1,
          endArrow: false,
          opacity: node.state === "wait" ? 0.55 : 1,
        },
      })),
      {
        id: "redo-review-worker",
        source: "reviewer",
        target: "worker",
        type: "quadratic",
        style: {
          curveOffset: 42,
          curvePosition: 0.5,
          endArrow: true,
          endArrowType: "vee",
          endArrowSize: 10,
          lineDash: [6, 5],
          lineWidth: 2.5,
          label: true,
          labelText: "未通过，回修",
          labelAutoRotate: false,
          labelBackground: true,
          labelBackgroundFill: "#fff1f0",
          labelBackgroundStroke: "#ffccc7",
          labelBackgroundRadius: 999,
          labelBackgroundPadding: [4, 10, 4, 10],
          labelFill: "#cf1322",
          labelFontSize: 12,
          labelFontWeight: 700,
          labelOffsetY: 10,
          sourcePort: "bottom",
          stroke: "#ff4d4f",
          targetPort: "bottom",
          zIndex: 2,
        },
      },
    ],
  };
}

function AgentLoopFlow({ payload }: { payload: DetailPayload }) {
  const nodes = useMemo(
    () => buildFlowNodes(payload),
    [payload.status, payload.fixAgent, payload.reviewAgent]
  );
  const flowSignature = useMemo(
    () =>
      nodes
        .map(node => `${node.id}:${node.state}:${node.title}:${node.subtitle}`)
        .join("|"),
    [nodes]
  );
  const graphRootRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const renderedSignatureRef = useRef("");
  const renderedWidthRef = useRef(0);
  const latestNodesRef = useRef(nodes);
  const latestSignatureRef = useRef(flowSignature);

  latestNodesRef.current = nodes;
  latestSignatureRef.current = flowSignature;

  useEffect(() => {
    const container = graphRootRef.current;
    if (!container) return undefined;
    let disposed = false;

    const measureWidth = () =>
      Math.max(620, Math.min(1150, container.clientWidth || FLOW_WIDTH));

    const syncGraph = () => {
      if (disposed) return;
      const nextWidth = measureWidth();
      const nextNodes = latestNodesRef.current;
      const nextSignature = latestSignatureRef.current;
      const graph = graphRef.current;

      if (graph) {
        const widthChanged = renderedWidthRef.current !== nextWidth;
        if (widthChanged) {
          graph.resize(nextWidth, FLOW_HEIGHT);
          renderedWidthRef.current = nextWidth;
        }
        if (widthChanged || renderedSignatureRef.current !== nextSignature) {
          graph.setData(buildG6FlowData(nextNodes, nextWidth));
          renderedSignatureRef.current = nextSignature;
          void graph.render();
        }
        return;
      }

      const nextGraph = new Graph({
        animation: false,
        behaviors: [],
        container,
        data: buildG6FlowData(nextNodes, nextWidth) as unknown as GraphData,
        height: FLOW_HEIGHT,
        node: {
          type: "rect",
          style: {
            port: true,
          },
        },
        padding: 0,
        width: nextWidth,
      });
      void nextGraph.render();
      graphRef.current = nextGraph;
      renderedSignatureRef.current = nextSignature;
      renderedWidthRef.current = nextWidth;
    };

    syncGraph();

    const ro = new ResizeObserver(syncGraph);
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = graphRootRef.current;
    const graph = graphRef.current;
    if (!container || !graph) return;

    const nextWidth = Math.max(
      620,
      Math.min(1150, container.clientWidth || FLOW_WIDTH)
    );
    if (
      renderedSignatureRef.current === flowSignature &&
      renderedWidthRef.current === nextWidth
    )
      return;

    if (renderedWidthRef.current !== nextWidth) {
      graph.resize(nextWidth, FLOW_HEIGHT);
      renderedWidthRef.current = nextWidth;
    }
    graph.setData(buildG6FlowData(nodes, nextWidth));
    renderedSignatureRef.current = flowSignature;
    void graph.render();
  }, [nodes, flowSignature]);

  return (
    <div className="native-flow-map">
      <div
        className="native-flow-g6-canvas"
        ref={graphRootRef}
        role="img"
        aria-label="AgentLoop 执行流程"
      />
      <div className="native-flow-legend">
        <span>
          <i className="native-flow-legend-line native-flow-legend-main" />
          主流程
        </span>
        <span>
          <i className="native-flow-legend-line native-flow-legend-redo" />
          未通过回修
        </span>
        <span>
          <i className="native-flow-legend-dot">✓</i>已通过
        </span>
      </div>
    </div>
  );
}

function EventTimeline({ payload }: { payload: DetailPayload }) {
  const events = payload.events || [];
  return (
    <div className="native-timeline-shell">
      {events.map((event, index) => {
        const tone = statusTone(String(event.status || event.label || ""));
        return (
          <div
            className={`native-timeline-row native-timeline-row-${tone}`}
            key={`${compactText(event.status || event.label)}-${index}`}
          >
            <span className="native-timeline-time">
              {compactText(event.timeText || event.status)}
            </span>
            <span className="native-timeline-dot">
              {tone === "success" ? (
                <CheckCircleFilled />
              ) : tone === "processing" ? (
                <PlayCircleFilled />
              ) : (
                <ClockCircleOutlined />
              )}
            </span>
            <span className="native-timeline-copy">
              <Text strong>
                {compactText(
                  event.label || event.status || `Event ${index + 1}`
                )}
              </Text>
              <Text type="secondary">
                {compactText(event.detail || event.summary || event.status)}
              </Text>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderCodeTokens(line: string): React.ReactNode[] {
  if (!line) return [" "];
  const tokenPattern =
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|[-]?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,])/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    let kind = "punctuation";
    if (token.startsWith('"'))
      kind =
        tokenPattern.lastIndex < line.length &&
        /^\s*:/.test(line.slice(tokenPattern.lastIndex))
          ? "key"
          : "string";
    else if (token === "true" || token === "false") kind = "boolean";
    else if (token === "null") kind = "null";
    else if (/^-?\d/.test(token)) kind = "number";
    nodes.push(
      <span
        className={CODE_TOKEN_CLASS_NAMES[kind]}
        key={`${match.index}-${token}`}
      >
        {token}
      </span>
    );
    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }
  return nodes.length > 0 ? nodes : [" "];
}

function CodeBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="native-code-shell">
      <button className="native-code-copy" type="button">
        copy
      </button>
      <pre className="native-code">
        {lines.map((line, index) => (
          <span
            className="native-code-line"
            key={`${index}-${line.slice(0, 16)}`}
          >
            <span className="native-code-no">{index + 1}</span>
            <span className="native-code-text">{renderCodeTokens(line)}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}

function ChangeStatsCard({ payload }: { payload: DetailPayload }) {
  const diffBytes = sumDiffBytes(payload.iterations || []);
  return (
    <Card title="修改统计" className="native-change-card">
      <Descriptions
        column={1}
        size="small"
        items={[
          {
            key: "files",
            label: "迭代次数",
            children: String((payload.iterations || []).length),
          },
          { key: "diff", label: "Diff", children: formatBytes(diffBytes) },
          {
            key: "events",
            label: "事件",
            children: String((payload.events || []).length),
          },
          {
            key: "gate",
            label: "通过率",
            children: payload.gateOk ? "100%" : "-",
          },
        ]}
      />
      <Progress
        percent={payload.gateOk ? 100 : 0}
        showInfo={false}
        status={payload.gateOk ? "success" : "active"}
      />
    </Card>
  );
}

function ReviewPanel({
  payload,
  reviewRounds,
}: {
  payload: DetailPayload;
  reviewRounds: Array<Record<string, unknown>>;
}) {
  if (!reviewRounds.length) {
    return (
      <List dataSource={reviewRounds} locale={{ emptyText: "暂无 Review" }} />
    );
  }
  return (
    <Space direction="vertical" className="native-stack">
      {reviewRounds.map((round, index) => (
        <Space
          direction="vertical"
          size="middle"
          className="native-review-card native-stack"
          key={`review-${compactText(round.round, String(index + 1))}`}
        >
          <Row align="middle" justify="space-between" gutter={[12, 12]}>
            <Col>
              <Space wrap>
                <Tag
                  color={statusTone(
                    String(round.verdict || round.decision || "")
                  )}
                >
                  ✓
                </Tag>
                <Text strong>
                  Review #{compactText(round.round, String(index + 1))} ·{" "}
                  {compactText(round.verdict || round.decision)}
                </Text>
              </Space>
            </Col>
            <Col>
              <Space wrap>
                <Tag>节点 #{compactText(round.round, String(index + 1))}</Tag>
                {round.riskLevel ? (
                  <Tag color="warning">
                    严重级别 {compactText(round.riskLevel)}
                  </Tag>
                ) : null}
              </Space>
            </Col>
          </Row>
          <Text type="secondary" style={{ whiteSpace: "pre-wrap" }}>
            {compactText(round.summary)}
          </Text>
          <CodeBlock text={jsonPreview({ reviewRounds: [round] })} />
        </Space>
      ))}
    </Space>
  );
}

function DetailTabs({ payload }: { payload: DetailPayload }) {
  const reviewRounds = payload.reviewRounds || [];
  const tabBody = (children: React.ReactNode) => (
    <div className="native-detail-tab-body">{children}</div>
  );
  return (
    <Card className="native-detail-workbench" styles={{ body: { padding: 0 } }}>
      <Tabs
        defaultActiveKey={payload.activeTab || "review"}
        tabBarStyle={{
          padding: "0 24px",
          marginBottom: 0,
        }}
        items={[
          {
            key: "review",
            label: "Review",
            children: tabBody(
              <ReviewPanel payload={payload} reviewRounds={reviewRounds} />
            ),
          },
          {
            key: "diff",
            label: "Diff",
            children: tabBody(
              <CodeBlock text={jsonPreview(payload.diffText || "暂无 diff")} />
            ),
          },
          {
            key: "agent",
            label: "Agent 输出",
            children: tabBody(
              <CodeBlock text={jsonPreview(payload.agentTail || "暂无输出")} />
            ),
          },
          {
            key: "artifacts",
            label: "Artifacts",
            children: tabBody(
              <>
                <Descriptions
                  column={1}
                  items={[
                    {
                      key: "report",
                      label: "最终报告",
                      children: compactText(payload.reportPath),
                    },
                    {
                      key: "json",
                      label: "结构化报告",
                      children: compactText(payload.reportJsonPath),
                    },
                    {
                      key: "landing",
                      label: "落地状态",
                      children: compactText(payload.landingPath),
                    },
                    {
                      key: "state",
                      label: "state.json",
                      children: compactText(payload.statePath),
                    },
                  ]}
                />
                {(payload.artifacts || []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text strong>其他制品</Text>
                    <List
                      size="small"
                      dataSource={payload.artifacts || []}
                      locale={{ emptyText: "暂无" }}
                      renderItem={(a: any) => (
                        <List.Item>
                          <Space
                            direction="vertical"
                            size={2}
                            style={{ width: "100%" }}
                          >
                            <Text>{a.title || a.id}</Text>
                            {a.content ? (
                              <CodeBlock
                                text={String(a.content).slice(0, 800)}
                              />
                            ) : null}
                          </Space>
                        </List.Item>
                      )}
                    />
                  </div>
                )}
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

function IterationTimeline({
  iterations,
}: {
  iterations: Array<Record<string, unknown>>;
}) {
  return (
    <List
      className="native-iteration-list"
      dataSource={iterations}
      locale={{ emptyText: "暂无修复迭代" }}
      renderItem={(iteration, index) => (
        <List.Item>
          <Space direction="vertical" size={4} className="native-stack">
            <Space wrap>
              <Tag color="processing">
                #{compactText(iteration.iteration, String(index + 1))}
              </Tag>
              <Tag>
                {compactText(
                  iteration.gateText ||
                    iteration.gate ||
                    (iteration.gateOk ? "Gate 绿" : "Gate")
                )}
              </Tag>
              <Tag>{formatBytes(Number(iteration.diffBytes) || 0)}</Tag>
            </Space>
            {iteration.summary ? (
              <Text type="secondary">{compactText(iteration.summary)}</Text>
            ) : null}
          </Space>
        </List.Item>
      )}
    />
  );
}

function DetailRightRail({ payload }: { payload: DetailPayload }) {
  const taskItems = [
    { key: "agent", label: "智能体", children: compactText(payload.agentText) },
    { key: "priority", label: "优先级", children: "P1" },
    { key: "env", label: "环境", children: "-" },
    {
      key: "branch",
      label: "分支/Commit",
      children: compactText(payload.commit),
    },
    { key: "issue", label: "相关 Issue", children: "-" },
    { key: "trigger", label: "触发方式", children: "手动触发" },
    { key: "owner", label: "负责人", children: "张三" },
  ];
  const railAction = (
    label: string,
    icon: React.ReactNode,
    onClick?: () => void
  ) => (
    <Button block className="native-rail-action" icon={icon} onClick={onClick}>
      <span className="native-rail-action-label">{label}</span>
      <RightOutlined className="native-rail-action-arrow" />
    </Button>
  );

  return (
    <Space direction="vertical" size="middle" className="native-detail-rail">
      <Card title="任务信息">
        <Descriptions column={1} size="small" items={taskItems} />
      </Card>
      <Card title="快捷操作" className="native-rail-actions">
        <Space direction="vertical" size="small" className="native-stack">
          {railAction("重新运行任务", <ReloadOutlined />, () =>
            postCommand("runTask", { task: payload.taskPath })
          )}
          {railAction("生成最终报告", <FileDoneOutlined />, () =>
            postCommand("openReport", { reportPath: payload.reportPath })
          )}
          {railAction("导出工作", <DownloadOutlined />)}
          {railAction("查看结构化报告", <SnippetsOutlined />, () =>
            postCommand("openReport", { reportPath: payload.reportJsonPath })
          )}
        </Space>
      </Card>
    </Space>
  );
}

function DetailChrome({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      prefixCls="agent-ant"
      csp={
        typeof window !== "undefined" && window.__AGENT_LOOP_CSP_NONCE__
          ? { nonce: window.__AGENT_LOOP_CSP_NONCE__ }
          : undefined
      }
    >
      <Layout className="native-dashboard native-detail-dashboard">
        <Layout className="native-main">
          <Header className="native-header">
            <Breadcrumb items={[{ title: "AgentLoop" }, { title: "Run" }]} />
          </Header>
          <Content className="native-content">{children}</Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

function metricItems(payload: DetailPayload) {
  return [
    {
      key: "iteration",
      title: "迭代次数",
      value: String((payload.iterations || []).length),
      icon: "#",
    },
    {
      key: "events",
      title: "事件总数",
      value: String((payload.events || []).length),
      icon: "E",
    },
    {
      key: "elapsed",
      title: "耗时",
      value: compactText(payload.elapsedText),
      icon: "T",
    },
    {
      key: "blocks",
      title: "阻断次数",
      value: String(blockCount(payload)),
      icon: "!",
    },
    {
      key: "status",
      title: "最终状态",
      value: compactText(payload.phaseLabel || payload.status),
      icon: "OK",
      tone: statusTone(payload.status),
    },
  ];
}

function DetailHero({ payload }: { payload: DetailPayload }) {
  const finalStatus = compactText(payload.phaseLabel || payload.status);
  return (
    <section className="native-detail-hero">
      <div className="native-run-head">
        <Space direction="vertical" size={10} className="native-run-title">
          <div className="native-title-line">
            <Button
              className="native-back-button"
              icon={<LeftOutlined />}
              onClick={() => postCommand("showOverview")}
              size="small"
            >
              返回
            </Button>
            <Title level={3}>
              {compactText(payload.taskLabel, "AgentLoop Run")}
            </Title>
          </div>
          <Space wrap>
            <Tag>Queue</Tag>
            <Tag color={statusTone(payload.status)}>{finalStatus}</Tag>
            {payload.landing?.status ? (
              <Tag color="success">{compactText(payload.landing.status)}</Tag>
            ) : null}
            {(payload as any).profileName ? (
              <Tag color="blue">Profile: {(payload as any).profileName}</Tag>
            ) : null}
          </Space>
          <Text type="secondary">
            Started {compactText(payload.runId)} · RunId:{" "}
            {compactText(payload.runId)} · Commit: {compactText(payload.commit)}
          </Text>
        </Space>
        <Space wrap className="native-run-actions">
          <Button
            type="primary"
            onClick={() => postCommand("runTask", { task: payload.taskPath })}
          >
            单跑此任务
          </Button>
          {payload.reportPath ? (
            <Button
              onClick={() =>
                postCommand("openReport", { reportPath: payload.reportPath })
              }
            >
              最终报告
            </Button>
          ) : null}
          {payload.reportJsonPath ? (
            <Button
              onClick={() =>
                postCommand("openReport", {
                  reportPath: payload.reportJsonPath,
                })
              }
            >
              结构化报告
            </Button>
          ) : null}
          {payload.landingPath ? (
            <Button
              onClick={() =>
                postCommand("openReport", { reportPath: payload.landingPath })
              }
            >
              落地状态
            </Button>
          ) : null}
          {payload.statePath ? (
            <Button
              onClick={() =>
                postCommand("openState", { statePath: payload.statePath })
              }
            >
              state.json
            </Button>
          ) : null}
          <Button onClick={() => postCommand("refresh")}>刷新</Button>
        </Space>
      </div>
      <div className="native-hero-kpis">
        <div className="native-metric-grid">
          {metricItems(payload).map(item => (
            <div
              className={`native-metric native-metric-${item.tone || "default"}`}
              key={item.key}
            >
              <span className="native-metric-icon">{item.icon}</span>
              <span className="native-metric-copy">
                <Text type="secondary">{item.title}</Text>
                <Text strong ellipsis={{ tooltip: item.value }}>
                  {item.value}
                </Text>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailProgress({ payload }: { payload: DetailPayload }) {
  const steps = payload.pipelineSteps || [];
  if (!steps.length) return null;
  const activeIndex = Math.max(
    0,
    steps.findIndex(step => step.active)
  );
  const doneCount = steps.filter(step => step.done).length;
  const completed = Math.max(doneCount, activeIndex >= 0 ? activeIndex + 1 : 0);
  const progressPercent = Math.min(
    100,
    Math.round((completed / steps.length) * 100)
  );
  return (
    <Card
      className="native-step-card"
      styles={{ body: { padding: "14px 18px" } }}
    >
      <Space direction="vertical" size="small" className="native-stack">
        <Space className="native-progress-head" size="middle">
          <Text type="secondary">整体进度</Text>
          <Text strong>{progressPercent}%</Text>
          <span className="native-progress-track">
            <Progress percent={progressPercent} showInfo={false} />
          </span>
        </Space>
        <div className="native-flow-lane">
          <AgentLoopFlow payload={payload} />
        </div>
        <Steps
          className="native-steps"
          size="small"
          current={activeIndex}
          items={steps.map(step => ({
            title: compactText(step.label || step.key),
            status: step.done ? "finish" : step.active ? "process" : "wait",
          }))}
        />
      </Space>
    </Card>
  );
}

export function DashboardDetailApp({ payload }: { payload: DetailPayload }) {
  return (
    <DetailChrome>
      <Space direction="vertical" size="middle" className="native-stack">
        <DetailHero payload={payload} />
        <DetailProgress payload={payload} />
        <div className="native-detail-main-grid">
          <div>
            <Space direction="vertical" size="middle" className="native-stack">
              <Card title="执行时间线" className="native-timeline-card">
                <EventTimeline payload={payload} />
              </Card>
              <ChangeStatsCard payload={payload} />
            </Space>
          </div>
          <div>
            <DetailTabs payload={payload} />
          </div>
          <div>
            <DetailRightRail payload={payload} />
          </div>
        </div>
      </Space>
    </DetailChrome>
  );
}
