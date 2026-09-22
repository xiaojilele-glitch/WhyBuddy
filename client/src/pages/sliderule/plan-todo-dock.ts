/**
 * 老师傅自己列的活儿清单——给人看进度，不进聊天。
 *
 * 2026-09-15 对照 Manus：待办是输入条上方一张卡，不是对话里一份
 * ○◐● 重印。条目只来自 `controlTodo`（模型 `todo_write` 写下的）。
 * 没有就不画，不许编一条。
 *
 * 卡面 2026-09-15 改回抄 Manus：默认折叠，脸上是当前条 + 做到第几条。
 * 清单自己滚（overflow-y-auto），底栏白底钉住——10 条长文案不许再叠上去。
 * 这里只认模型 `todo_write` 写下的状态。host 不许按工程动作猜进度。
 * `planTodoCompleted` 仍给进度条量纲，脸上不画。
 */
export type PlanTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PlanTodoItem = {
  id: string;
  status: PlanTodoStatus;
  content: string;
};

const STATUSES = new Set<PlanTodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

function statusOf(raw: unknown): PlanTodoStatus {
  const value = String(raw || "").trim().toLowerCase();
  return STATUSES.has(value as PlanTodoStatus)
    ? (value as PlanTodoStatus)
    : "pending";
}

/**
 * 同文案只留一条。跟 Python `plan_todo._collapse_same_content` 同一把尺子。
 *
 * ⚠ 2026-09-19 飞机大战：旧 id + task-N 已经落库 16 条。只修服务端
 *   apply、浮层仍读原数组，脸上继续钉「Canvas… 3/16」。
 */
const STATUS_RANK: Record<PlanTodoStatus, number> = {
  cancelled: -1,
  pending: 0,
  in_progress: 1,
  completed: 2,
};

export function collapseSameContent(items: PlanTodoItem[]): PlanTodoItem[] {
  const at = new Map<string, number>();
  const out: PlanTodoItem[] = [];
  for (const item of items) {
    const seen = at.get(item.content);
    if (seen == null) {
      at.set(item.content, out.length);
      out.push({ ...item });
      continue;
    }
    const kept = out[seen];
    if (STATUS_RANK[item.status] >= STATUS_RANK[kept.status]) {
      kept.status = item.status;
    }
    kept.id = item.id;
  }
  return out;
}

/** 脏数据丢掉。空 content 不算一条。 */
export function visiblePlanTodo(raw: unknown): PlanTodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanTodoItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const content = String(
      (row as { content?: unknown }).content || ""
    ).trim();
    if (!content) continue;
    const id = String((row as { id?: unknown }).id || content).trim();
    out.push({
      id,
      status: statusOf((row as { status?: unknown }).status),
      content,
    });
  }
  return collapseSameContent(out);
}

export function planTodoProgress(items: readonly PlanTodoItem[]): {
  current: number;
  total: number;
  currentContent: string | null;
} {
  const open = items.filter(item => item.status !== "cancelled");
  const total = open.length;
  if (!total) return { current: 0, total: 0, currentContent: null };
  const working = open.findIndex(item => item.status === "in_progress");
  if (working >= 0) {
    return {
      current: working + 1,
      total,
      currentContent: open[working].content,
    };
  }
  const pending = open.findIndex(item => item.status === "pending");
  if (pending >= 0) {
    return {
      current: pending + 1,
      total,
      currentContent: open[pending].content,
    };
  }
  return { current: total, total, currentContent: null };
}

/**
 * 进度条用「已完成 / 未作废」，不是「正在做的是第几条」。
 * 后者仍走 planTodoProgress（Manus 那格 1/4）。
 * 不许拿假百分比充分子——没有 completed 就是 0。
 */
export type PlanTodoAction = {
  id: string;
  tool: string;
  detail?: string;
};

export function planTodoCompleted(items: readonly PlanTodoItem[]): {
  done: number;
  total: number;
  percent: number;
} {
  const open = items.filter(item => item.status !== "cancelled");
  const total = open.length;
  const done = open.filter(item => item.status === "completed").length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}
