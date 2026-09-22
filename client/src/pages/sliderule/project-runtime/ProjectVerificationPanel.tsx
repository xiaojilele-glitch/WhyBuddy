import React, { useEffect, useRef, useState } from "react";
import { ProjectEvidenceImages } from "./ProjectEvidenceImages";
import {
  cancelProjectVerification,
  getProjectVerification,
  ProjectVerificationError,
  requestProjectVerification,
  type ProjectVerificationView,
} from "./project-verification-client";

interface Props {
  projectId?: string | null;
  revision?: string | null;
  runtimeOperationId?: string | null;
  runtimeId?: string | null;
  suiteVersion?: string | null;
  ready: boolean;
  /**
   * ⚠ 2026-09-15：会话工作台不再把本面板挂到源码档上。真机 compact
   * 只收起详情，标题行「更新检查状态 / 检查应用」照样占一条。需要压
   * 详情时（单测或其它宿主）仍可传 compact。
   */
  compact?: boolean;
}

const POLL_MS = 3000;
const ACTIVE = new Set(["queued", "running", "waiting_user", "cancelling"]);
const STATUS: Record<string, string> = {
  queued: "已排队",
  running: "检查中",
  waiting_user: "等待处理",
  cancelling: "正在停止检查",
  passed: "页面检查通过",
  failed: "页面检查失败",
  blocked: "缺少检查条件",
  cancelled: "检查已取消",
  stale: "旧版本记录，需重新检查",
};
const ASSERTIONS: Record<string, string> = {
  setup_admin: "首次建立应用管理员",
  writer_login: "可写用户登录",
  task_create: "新增任务写入真实接口",
  task_edit: "编辑任务并保存",
  task_filter: "筛选任务",
  task_refresh: "刷新后任务仍然保存",
  reader_create: "建立只读应用用户",
  reader_login: "只读用户登录（页面凭据）",
  reader_api_session: "只读用户登录（独立接口凭据）",
  reader_ui_readonly: "只读界面不提供修改操作",
  reader_api_forbidden: "只读用户调用写接口被拒绝",
  anonymous_api_forbidden: "未登录调用接口被拒绝",
  heading_visible: "页面标题可见",
  counter_initial: "计数初始状态正确",
  counter_increment: "首次点击更新计数",
  counter_second_increment: "再次点击更新计数",
  reload_reset: "刷新后计数按模板重置",
  no_page_errors: "没有未捕获页面错误",
  no_failed_requests: "页面资源请求成功",
};
// ⚠ 2026-09-17：这张表是"名单报满"改动的**第六处**，差点漏掉（§4）。
//   加上 not_run 之后，如果这里还是 `status === "passed" ? "通过" : "失败"`，
//   被超时切掉、根本没跑的三条会在界面上写成"失败"——把这次修复要消灭的
//   那个谎言原样搬到用户眼前。前端判据当时全绿，因为没有一条喂 not_run（§5）。
const ASSERTION_STATUS: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  not_run: "未执行",
};
const ERRORS: Record<string, string> = {
  project_build_failed: "当前源码构建失败，请先修复构建错误。",
  project_browser_not_configured: "当前环境尚未配置浏览器检查。",
  project_browser_key_missing: "当前环境缺少浏览器运行凭据。",
  project_browser_unavailable: "浏览器运行环境暂时不可用。",
  project_browser_auth_failed: "浏览器未能获得当前工程的访问授权。",
  project_browser_revision_mismatch: "检查期间工程版本发生变化，需要重新检查。",
  project_browser_navigation_blocked: "页面跳转超出本次允许的检查范围。",
  project_browser_assertion_failed: "已执行的页面检查中有断言失败。",
  project_browser_timeout: "浏览器检查超时，请稍后重试。",
  project_browser_cleanup_pending: "浏览器资源仍在回收，检查尚未完成。",
  project_browser_preview_unavailable:
    "私有预览通道尚未建立，浏览器进不了页面，不能当作业务验收通过。",
  project_browser_evidence_unavailable:
    "浏览器检查没有留下可信证据，不能当作验收通过。",
  project_browser_verification_interrupted: "浏览器检查被中断，需要重新检查。",
};
const message = (error: unknown) =>
  error instanceof ProjectVerificationError
    ? error.message
    : "暂时无法连接工程检查服务，请稍后重试。";

/**
 * Checking a template proves only the recorded page interactions. Reload reads
 * durable evidence and never starts another job. A source/runtime switch must
 * hide old success during render, before effects can abort outstanding replies.
 */
export function ProjectVerificationPanel({
  projectId,
  revision,
  runtimeOperationId,
  runtimeId,
  suiteVersion,
  ready,
  compact = false,
}: Props) {
  const scope = JSON.stringify([
    projectId,
    revision,
    runtimeOperationId,
    runtimeId,
  ]);
  const [state, setState] = useState<{
    scope: string;
    loading: boolean;
    busy: boolean;
    view: ProjectVerificationView | null;
    error: string | null;
    commandError: string | null;
  }>({
    scope,
    loading: Boolean(projectId),
    busy: false,
    view: null,
    error: null,
    commandError: null,
  });
  const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [collapsed, setCollapsed] = useState(compact);

  useEffect(() => {
    if (compact) setCollapsed(true);
  }, [compact]);

  useEffect(() => {
    const current = ++generation.current;
    idempotencyKey.current = null;
    setState({
      scope,
      loading: Boolean(projectId),
      busy: false,
      view: null,
      error: null,
      commandError: null,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (!projectId) return;
      if (writeRequest.current) {
        timer = setTimeout(() => void refresh(), POLL_MS);
        return;
      }
      readRequest.current?.abort();
      const controller = new AbortController();
      readRequest.current = controller;
      try {
        const view = await getProjectVerification(projectId, controller.signal);
        if (controller.signal.aborted || generation.current !== current) return;
        setState(prev => ({
          ...prev,
          scope,
          loading: false,
          view,
          error: null,
        }));
      } catch (error) {
        if (controller.signal.aborted || generation.current !== current) return;
        setState(prev => ({
          ...prev,
          loading: false,
          view: null,
          error: message(error),
        }));
      } finally {
        if (!controller.signal.aborted && generation.current === current)
          timer = setTimeout(() => void refresh(), POLL_MS);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    return () => {
      generation.current++;
      clearTimeout(timer);
      readRequest.current?.abort();
      writeRequest.current?.abort();
      writeRequest.current = null;
    };
  }, [projectId, scope]);

  const current = state.scope === scope;
  const view = current ? state.view : null;
  const snapshot = view?.snapshot;
  const record = snapshot?.verification;
  const effectiveSuite = record?.suiteVersion ?? suiteVersion;
  const tasks = effectiveSuite === "react-vite-tasks@1";
  const counter = effectiveSuite === "react-vite-counter@1";
  // A newly created project has no runtime descriptor yet. Unknown capability
  // must not label a tasks project as the counter template before its first run.
  const title = tasks
    ? "任务应用与权限检查"
    : counter
      ? "页面与计数交互检查"
      : "浏览器检查";
  const build = record?.build;
  const stale = Boolean(
    record &&
    (snapshot?.effectiveStatus === "stale" ||
      record.revision !== revision ||
      record.runtimeId !== runtimeId ||
      record.runtimeOperationId !== runtimeOperationId)
  );
  const operationActive = Boolean(
    view?.operationStatus && ACTIVE.has(view.operationStatus)
  );
  const active = operationActive || snapshot?.effectiveStatus === "running";
  const status = stale
    ? "stale"
    : operationActive
      ? view!.operationStatus!
      : (snapshot?.effectiveStatus ??
        (view?.operationStatus === "cancelled"
          ? "cancelled"
          : view?.operationId
            ? "blocked"
            : null));
  const loading = !current || state.loading;
  const busy = current && state.busy;
  const canStart = Boolean(
    projectId &&
    revision &&
    runtimeOperationId &&
    runtimeId &&
    ready &&
    !loading &&
    !busy &&
    !active &&
    !state.error
  );

  const command = async (cancel = false) => {
    if (
      writeRequest.current ||
      !current ||
      (cancel ? !active || !view?.operationId : !canStart)
    )
      return;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    writeRequest.current = controller;
    readRequest.current?.abort();
    setState(prev => ({
      ...prev,
      busy: true,
      error: null,
      commandError: null,
    }));
    try {
      if (cancel) {
        await cancelProjectVerification(view!.operationId!, controller.signal);
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration
        )
          return;
        setState(prev => ({
          ...prev,
          view: prev.view
            ? { ...prev.view, operationStatus: "cancelling" }
            : null,
        }));
      } else {
        idempotencyKey.current ??= `browser-check:${crypto.randomUUID()}`;
        const result = await requestProjectVerification(
          runtimeOperationId!,
          revision!,
          idempotencyKey.current,
          controller.signal
        );
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration
        )
          return;
        idempotencyKey.current = null;
        setState(prev => ({
          ...prev,
          view: {
            operationId: result.operationId,
            operationStatus: result.status,
            snapshot: null,
          },
        }));
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        generation.current === currentGeneration
      )
        setState(prev => ({ ...prev, commandError: message(error) }));
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null;
      if (generation.current === currentGeneration) {
        setState(prev => ({ ...prev, busy: false }));
        void refreshRef.current();
      }
    }
  };

  return (
    <section
      data-testid="project-verification-panel"
      aria-label={title}
      className="shrink-0 border-b border-stone-200 bg-stone-50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-stone-700">
              {title}
            </h3>
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
              title="由受控 Playwright 浏览器执行真实页面、网络和权限断言">
              浏览器检查
            </span>
          </div>
          <p
            data-testid="project-verification-status"
            role="status"
            className="text-xs text-stone-600"
          >
            {loading
              ? "正在读取检查记录"
              : state.error
                ? "暂时无法读取检查状态"
                : busy && !active
                  ? "正在提交检查"
                  : status
                    ? tasks && status === "passed"
                      ? "任务应用检查通过"
                      : tasks && status === "failed"
                        ? "任务应用检查失败"
                        : STATUS[status]
                    : "尚未检查"}
          </p>
        </div>
        {active && view?.operationId ? (
          <button
            type="button"
            disabled={busy || view.operationStatus === "cancelling"}
            onClick={() => void command(true)}
            data-testid="project-verification-cancel"
            className="rounded-md px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
          >
            停止检查
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void refreshRef.current()}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
        >
          更新检查状态
        </button>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => void command()}
          data-testid="project-verification-start"
          className="rounded-md bg-stone-800 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {tasks
            ? record
              ? "重新检查任务应用"
              : "检查任务应用"
            : counter
              ? record
                ? "重新检查页面"
                : "检查页面"
              : record
                ? "重新检查应用"
                : "检查应用"}
        </button>
        <button
          type="button"
          data-testid="project-verification-toggle"
          aria-expanded={!collapsed}
          aria-controls="project-verification-details"
          onClick={() => setCollapsed(value => !value)}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
        >
          {collapsed ? "展开检查详情" : "收起检查详情"}
        </button>
      </div>
      <div
        id="project-verification-details"
        data-testid="project-verification-details"
        hidden={collapsed}
      >
      <p className="mt-1 text-xs leading-5 text-stone-500">
        {tasks
          ? "检查本次固定版本的任务新增、编辑、筛选、刷新持久化和只读权限；结果仅覆盖已执行用例，整体交付仍由服务端另行判定。"
          : counter
            ? "仅检查固定模板的页面与计数交互；业务功能、数据持久化和角色权限仍需另行验收。"
            : "检查范围尚未确定；工程就绪后将根据支持的检查用例验证当前版本，结果以实际执行记录为准。"}
      </p>
      {snapshot?.deliveryEligible && !stale ? (
        <p className="mt-1 text-xs leading-5 text-stone-700">
          当前版本满足任务应用验收范围，可在「交付」查看范围并准备源码与证据包。
        </p>
      ) : null}
      {current && state.error ? (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {state.error}
        </p>
      ) : null}
      {current && state.commandError ? (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {state.commandError}
        </p>
      ) : null}
      {!loading && !state.error && record?.errorCode ? (
        <p className="mt-1 text-xs text-amber-800">
          {ERRORS[record.errorCode] ??
            "本次检查未能完整完成，请查看已执行检查并重试。"}
        </p>
      ) : null}
      {record?.assertions?.length ? (
        <details className="mt-1 text-xs text-stone-600">
          <summary className="cursor-pointer">
            {stale ? "查看旧版本检查记录" : "查看已执行检查"}（
            {record.assertions.filter(item => item.status !== "not_run").length}
            {record.assertions.some(item => item.status === "not_run")
              ? ` / ${record.assertions.length}`
              : ""}
            {" 项）"}
          </summary>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {record.assertions.map((assertion, index) => (
              <li key={`${assertion.id}:${index}`}>
                {ASSERTIONS[assertion.id] ?? "页面检查项"}：
                {ASSERTION_STATUS[assertion.status] ?? "失败"}
                {/* ⚠ 只显示收据里的封闭词表值（角色名 / 状态码）。
                    detail 是失败的类别，对用户没意义，不显示；
                    页面文本从来进不了收据，这里也不会有。 */}
                {assertion.status === "failed" && assertion.actual
                  ? `（预期 ${assertion.expected ?? "—"}，实际 ${assertion.actual}）`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {build ? (
        <details
          className="mt-2 text-xs text-stone-600"
          data-testid="project-build-evidence"
        >
          <summary className="cursor-pointer">
            {stale ? "旧版本构建证据" : "构建证据"}：
            {
              {
                passed: "构建通过",
                failed: "构建失败",
                blocked: "缺少构建条件",
                cancelled: "构建已取消",
              }[build.status]
            }
          </summary>
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>源码版本</dt>
            <dd className="break-all font-mono">{build.revision}</dd>
            <dt>安装 / 构建退出码</dt>
            <dd>
              {build.installExitCode ?? "未执行"} /{" "}
              {build.buildExitCode ?? "未执行"}
            </dd>
            <dt>锁文件校验</dt>
            <dd className="break-all font-mono">{build.lockfileHash}</dd>
            <dt>构建产物校验</dt>
            <dd className="break-all font-mono">
              {build.outputHash ?? "无产物"}
            </dd>
            <dt>构建产物</dt>
            <dd>
              {build.outputFileCount} 个文件 · {build.outputBytes} 字节
            </dd>
          </dl>
        </details>
      ) : null}
      {record ? <ProjectEvidenceImages record={record} stale={stale} /> : null}
      </div>
    </section>
  );
}
