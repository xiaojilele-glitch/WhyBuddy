/**
 * live-runtime — 浏览器运行时内核（"像 ECharts 一样渲染系统"）。
 *
 * 五系统模型（gate 通过的 JSON）→ 可操作的运行时状态：
 *   - entities: 每实体一组内存行（动态表的浏览器版）
 *   - instances: 审批流程实例（沿 workflow.transitions 推进的状态机）
 *
 * 执行语义参考 rbac-backend 引擎的已验证实现（workflowEngine.moveToNextNode /
 * dynamicDataService），但零数据库、零服务：状态就是 JSON，持久化走会话存档。
 * 诚实边界：不做会签/或签百分比、子流程、自动节点外呼——排练运行时以
 * "业务闭环可走通"为目标，不冒充企业级完备。
 *
 * 纯函数模块：所有变更返回新对象，无副作用，便于单测与撤销。
 */

import type {
  FiveSystemField,
  FiveSystemModel,
  WorkflowTransition,
} from "../system-screens/five-system-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuntimeRow = {
  id: string;
  values: Record<string, unknown>;
  createdAt: string;
  /**
   * 演示种子行标记（见 demo-seed.ts）。真实写入的行永远没有这个字段——
   * 渲染层据此出「示例数据」徽标，用户写第一条真实数据时按它整批清掉。
   */
  seed?: true;
  /**
   * 连接器取回来的真实行（见 connector-rows.ts）。
   *
   * 跟 `seed` 是**互斥**的两个标记，哲学也是一对的：种子标出来是因为
   * "伪造得越像越该标出来"，真实行标出来是因为"真实得越像也越该标出来源"。
   * 渲染层据此出「实时 · 来源 · 几点取的」，用户一眼分得清这页数字算不算数。
   */
  live?: { connector: string; source: string; fetchedAt: string };
};

export interface WorkflowInstanceLog {
  at: string;
  nodeId: string;
  action: "start" | "approve" | "reject" | "complete";
  byRole?: string;
  note?: string;
}

export interface WorkflowInstance {
  id: string;
  title: string;
  /** 当前停留节点；终态后保留最后节点 */
  currentNodeId: string;
  status: "running" | "completed" | "rejected";
  /** 关联的实体行（Page 提交联动时使用，可空） */
  entityRef?: { entityId: string; rowId: string };
  log: WorkflowInstanceLog[];
}

/**
 * 一张表的数据来历（连接器供数时）。
 *
 * ⚠ **这个形状只准有这一份。** 第一版在 connector-rows.ts 里另写了一个同名
 *   interface，这里用的是行内的匿名对象——加 `note?` 时只改了那一份，
 *   `tsc` 当场红（"Property 'note' does not exist"）。这次运气好是编译期
 *   报的；仓里第四条那些"只改一半"的坑，大多数没这么好运，只会静默半失效。
 */
export interface ConnectorMeta {
  connector: string;
  source: string;
  fetchedAt: string;
  /**
   * 零行时的说明（可选）。
   *
   * "这张表为什么空着"有**两种**完全不同的答案，用户需要分得清：
   *   - 取数失败（默认）→「数据源没接上」，这是个问题
   *   - 只读预览根本没取 →「预览里不取实时数据」，这不是问题
   * 都显示成前者会让人以为线上应用挂了。
   */
  note?: string;
}

export interface RuntimeState {
  /** entityId → rows */
  entities: Record<string, RuntimeRow[]>;
  instances: WorkflowInstance[];
  /** 单调递增，生成稳定 id 用（避免 Date.now 依赖注入烦恼仍需时间戳时由调用方传入） */
  seq: number;
  /**
   * 实体 → 当前这条记录的 id。
   *
   * ⚠ 2026-09-07：HTML 页的详情卡（data-record）原先没选过就填第一行。
   *   点列表一行只开抽屉，页内主从未跟着切——区块页已经有 PageFocusState，
   *   这条是同一份概念接到 RuntimeState 上，给 HTML 绑定解释器读。
   *   对象由宿主钉，不烤进生成的 HTML（petite-vue v-scope 同一纪律）。
   */
  selection?: Record<string, string>;
  /**
   * 收银/备货那种「从货架点进购物车」的数量。
   *
   * ⚠ 2026-09-07 烘焙坊收银台：货架和购物车都打了 data-rows="product"，
   *   解释器把整张商品表填进购物车，加减按钮又没有 data-action
   *   （生成页的 onclick 被消毒剥掉）。点了没反应。数量记在运行时，
   *   不烤进 HTML，跟 selection 同一纪律。
   */
  cartQty?: Record<string, Record<string, number>>;
  /**
   * 已经对"要不要铺演示种子"做过决定的实体（见 demo-seed.ts）。
   *
   * 存的是**决定过**，不是**铺过**：首次遇见时已有真实数据的实体也记在这里，
   * 保证每个实体这辈子只判一次。缺了它就只能看"当前行数为 0"，于是用户把表
   * 删空之后示例数据会自己长回来。老状态没有这个字段，按空处理即可。
   */
  seededEntities?: Record<string, true>;
  /**
   * 绑到连接器上的实体 → 这份数据的来历。
   *
   * ⚠ 它同时是**"这张表不许铺演示种子"的凭据**（见 demo-seed.seedRuntimeState）。
   *   种子的存在前提是"零行 = 一片空壳，展会上不好看"，那对普通实体成立；
   *   对连接器实体不成立——种子在这里正好是它要消灭的东西。数据源没接上时
   *   必须是**诚实空态 + 一句为什么**，不是 12 行编出来的漂亮数字。
   */
  connectorEntities?: Record<string, ConnectorMeta>;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initRuntimeState(model: FiveSystemModel | null | undefined): RuntimeState {
  const entities: Record<string, RuntimeRow[]> = {};
  for (const entity of model?.datamodel?.entities ?? []) {
    if (entity.id) entities[entity.id] = [];
  }
  return { entities, instances: [], seq: 0 };
}

// ---------------------------------------------------------------------------
// 行 CRUD（动态表的浏览器版）
// ---------------------------------------------------------------------------

export function addRow(
  state: RuntimeState,
  entityId: string,
  values: Record<string, unknown>,
  now: string
): { state: RuntimeState; row: RuntimeRow } {
  const seq = state.seq + 1;
  const row: RuntimeRow = { id: `row-${seq}`, values, createdAt: now };
  const rows = [...(state.entities[entityId] ?? []), row];
  return {
    state: pinSelection(
      { ...state, seq, entities: { ...state.entities, [entityId]: rows } },
      entityId,
      row.id
    ),
    row,
  };
}

export function updateRow(
  state: RuntimeState,
  entityId: string,
  rowId: string,
  values: Record<string, unknown>
): RuntimeState {
  // 被编辑过的演示种子行不再算种子（seed 标记去掉）——里面已经有用户真写的
  // 值了，继续挂「示例数据」徽标是在谎报。见 demo-seed.ts。
  const rows = (state.entities[entityId] ?? []).map((r) => {
    if (r.id !== rowId) return r;
    const { seed: _seed, ...rest } = r;
    return { ...rest, values: { ...r.values, ...values } };
  });
  return { ...state, entities: { ...state.entities, [entityId]: rows } };
}

export function deleteRow(state: RuntimeState, entityId: string, rowId: string): RuntimeState {
  const rows = (state.entities[entityId] ?? []).filter((r) => r.id !== rowId);
  const next = { ...state, entities: { ...state.entities, [entityId]: rows } };
  return state.selection?.[entityId] === rowId
    ? clearSelection(next, entityId)
    : next;
}

function pinSelection(
  state: RuntimeState,
  entityId: string,
  rowId: string
): RuntimeState {
  if (state.selection?.[entityId] === rowId) return state;
  return {
    ...state,
    selection: { ...state.selection, [entityId]: rowId },
  };
}

function clearSelection(state: RuntimeState, entityId: string): RuntimeState {
  if (!state.selection || !(entityId in state.selection)) return state;
  const selection = { ...state.selection };
  delete selection[entityId];
  return {
    ...state,
    selection: Object.keys(selection).length ? selection : undefined,
  };
}

/**
 * 把「当前这条」钉进运行时。行不在表里就不动——不许把详情卡指到空气。
 */
export function selectRecord(
  state: RuntimeState,
  entityId: string,
  rowId: string
): RuntimeState {
  const id = String(rowId || "").trim();
  if (!id) return state;
  const rows = state.entities[entityId] ?? [];
  if (!rows.some(r => r.id === id)) return state;
  return pinSelection(state, entityId, id);
}

function qtyMap(
  state: RuntimeState,
  entityId: string
): Record<string, number> {
  return { ...(state.cartQty?.[entityId] ?? {}) };
}

export function addToCart(
  state: RuntimeState,
  entityId: string,
  rowId: string
): RuntimeState {
  const id = String(rowId || "").trim();
  if (!id) return state;
  const rows = state.entities[entityId] ?? [];
  if (!rows.some(r => r.id === id)) return state;
  const next = qtyMap(state, entityId);
  next[id] = (next[id] || 0) + 1;
  return {
    ...pinSelection(state, entityId, id),
    cartQty: { ...state.cartQty, [entityId]: next },
  };
}

export function adjustCartQty(
  state: RuntimeState,
  entityId: string,
  rowId: string,
  delta: number
): RuntimeState {
  const id = String(rowId || "").trim();
  if (!id || !delta) return state;
  const next = qtyMap(state, entityId);
  const n = (next[id] || 0) + delta;
  if (n <= 0) delete next[id];
  else next[id] = n;
  return { ...state, cartQty: { ...state.cartQty, [entityId]: next } };
}

export function clearCart(
  state: RuntimeState,
  entityId: string
): RuntimeState {
  if (!state.cartQty?.[entityId]) return state;
  const cartQty = { ...state.cartQty };
  delete cartQty[entityId];
  return { ...state, cartQty };
}

/** 一条字段级的校验结论：`fieldId` 让表单能把红字标在出问题的那一栏上。 */
export interface FieldProblem {
  fieldId: string;
  message: string;
}

const _blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * 表单校验：**只验模型真的声明过的东西**（2026-08-13 扩）。
 *
 * ## 为什么不做"必填"
 *
 * `FiveSystemField` 里**没有 required 这一维**（id / name / type / options /
 * format / refEntity 就这些）。要标必填就得靠猜——猜哪个字段重要，猜错的代价是
 * 用户被拦住却不知道为什么。所以这里一条都不猜，只把已声明的约束验到位；
 * 真要必填，得先往契约里加 `required`，让生成侧显式声明。
 *
 * 唯一的例外是最后那条「整条全空」：它不需要知道哪个字段重要，只是拦住
 * "什么都没填就点保存"——那种记录对任何模型都没有意义。
 *
 * ## 扩之前只有一条
 *
 * 原来只验 number 能不能转成数。于是 enum 字段能存进 options 里根本没有的值、
 * ref 字段能指向一条不存在的记录、date 字段能存 "昨天下午"——**这些约束模型
 * 全都声明了，只是没人去对**。线上那个音乐收藏库就是这么被填进一行全 "1" 的。
 *
 * `rows` 可选：只有验 ref 指向存在时才需要它。不传就跳过那一条（旧调用方
 * 逐字节保持原行为）。
 */
export function validateRowFields(
  model: FiveSystemModel | null | undefined,
  entityId: string,
  values: Record<string, unknown>,
  rows?: Record<string, RuntimeRow[]>
): FieldProblem[] {
  const entity = (model?.datamodel?.entities ?? []).find((e) => e.id === entityId);
  if (!entity) return [];
  const problems: FieldProblem[] = [];
  const label = (f: FiveSystemField) => f.name || f.id;

  for (const field of entity.fields ?? []) {
    const v = values[field.id];
    if (_blank(v)) continue; // 空值交给下面那条「整条全空」，单字段不拦

    if (field.type === "number" && Number.isNaN(Number(v))) {
      problems.push({ fieldId: field.id, message: `${label(field)} 应为数字` });
      continue;
    }
    if (field.type === "enum" && (field.options?.length ?? 0) > 0) {
      const ok = field.options!.some((o) => o.id === String(v));
      if (!ok) {
        const names = field.options!.map((o) => o.label || o.id).join(" / ");
        problems.push({ fieldId: field.id, message: `${label(field)} 只能是：${names}` });
      }
      continue;
    }
    if (field.type === "date" && Number.isNaN(new Date(String(v)).getTime())) {
      problems.push({ fieldId: field.id, message: `${label(field)} 不是有效日期` });
      continue;
    }
    if (field.type === "ref" && rows) {
      // refEntity 缺席是存量模型的常态（见它的契约注释），那种情况不判——
      // 猜出来的目标实体验不准，宁可不验。
      const target = field.refEntity;
      if (target && !(rows[target] ?? []).some((r) => r.id === String(v))) {
        problems.push({ fieldId: field.id, message: `${label(field)} 指向的记录不存在` });
      }
    }
  }

  const allBlank = (entity.fields ?? []).every((f) => _blank(values[f.id]));
  if (allBlank) problems.push({ fieldId: "", message: "至少填写一个字段" });

  return problems;
}

/** `validateRowFields` 的字符串视图。老调用方（EntityDataPanel 等）继续用它。 */
export function validateRowValues(
  model: FiveSystemModel | null | undefined,
  entityId: string,
  values: Record<string, unknown>,
  rows?: Record<string, RuntimeRow[]>
): string[] {
  return validateRowFields(model, entityId, values, rows).map((p) => p.message);
}

// ---------------------------------------------------------------------------
// 审批状态机（语义对齐 workflowEngine.moveToNextNode）
// ---------------------------------------------------------------------------

/** 流程起点：没有任何入边的节点（多个则取模型顺序第一个）。 */
export function startNodeId(model: FiveSystemModel | null | undefined): string | null {
  const nodes = model?.workflow?.nodes ?? [];
  if (nodes.length === 0) return null;
  const hasInbound = new Set((model?.workflow?.transitions ?? []).map((t) => t.to));
  return nodes.find((n) => !hasInbound.has(n.id))?.id ?? nodes[0].id;
}

/** 当前节点的出边（分支时由 UI 给用户选择）。 */
export function outgoingTransitions(
  model: FiveSystemModel | null | undefined,
  nodeId: string
): WorkflowTransition[] {
  return (model?.workflow?.transitions ?? []).filter((t) => t.from === nodeId);
}

export function nodeById(model: FiveSystemModel | null | undefined, nodeId: string) {
  return (model?.workflow?.nodes ?? []).find((n) => n.id === nodeId) ?? null;
}

export function startInstance(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  title: string,
  now: string,
  entityRef?: WorkflowInstance["entityRef"]
): { state: RuntimeState; instance: WorkflowInstance | null } {
  const start = startNodeId(model);
  if (!start) return { state, instance: null };
  const seq = state.seq + 1;
  const instance: WorkflowInstance = {
    id: `inst-${seq}`,
    title,
    currentNodeId: start,
    status: "running",
    entityRef,
    log: [{ at: now, nodeId: start, action: "start" }],
  };
  return {
    state: { ...state, seq, instances: [...state.instances, instance] },
    instance,
  };
}

/**
 * 推进实例：approve 沿出边走（多出边必须指定 viaTransition 下标，UI 负责让用户选）；
 * 无出边即 completed。reject 直接终态 rejected（对齐引擎语义：reject 即终态）。
 */
export function advanceInstance(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  instanceId: string,
  action: "approve" | "reject",
  now: string,
  opts: { byRole?: string; viaTransitionIndex?: number } = {}
): { state: RuntimeState; error?: string } {
  const idx = state.instances.findIndex((i) => i.id === instanceId);
  if (idx < 0) return { state, error: "实例不存在" };
  const instance = state.instances[idx];
  if (instance.status !== "running") return { state, error: "实例已终态" };

  const log = [...instance.log];
  let next: WorkflowInstance;

  if (action === "reject") {
    log.push({ at: now, nodeId: instance.currentNodeId, action: "reject", byRole: opts.byRole });
    next = { ...instance, status: "rejected", log };
  } else {
    const outs = outgoingTransitions(model, instance.currentNodeId);
    log.push({ at: now, nodeId: instance.currentNodeId, action: "approve", byRole: opts.byRole });
    if (outs.length === 0) {
      log.push({ at: now, nodeId: instance.currentNodeId, action: "complete" });
      next = { ...instance, status: "completed", log };
    } else {
      const chosen =
        outs.length === 1 ? outs[0] : outs[opts.viaTransitionIndex ?? -1];
      if (!chosen) return { state, error: "存在分支，需要选择走向" };
      next = { ...instance, currentNodeId: chosen.to, log };
    }
  }

  const instances = [...state.instances];
  instances[idx] = next;
  return { state: { ...state, instances } };
}

// ---------------------------------------------------------------------------
// HTML 页面的转移动作（2026-08-14 晚：工作流那只手伸进 HTML 页）
// ---------------------------------------------------------------------------

/** 转移动作的结果：ok=false 时 state 原样返回，message 是给用户看的原话。 */
export interface WorkflowActionResult {
  state: RuntimeState;
  ok: boolean;
  message: string;
}

/** 这行记录当前进行中的流程实例（一行至多一个 running——submit 时守住的）。 */
export function runningInstanceFor(
  state: RuntimeState,
  entityId: string,
  rowId: string
): WorkflowInstance | null {
  return (
    state.instances.find(
      (i) =>
        i.status === "running" &&
        i.entityRef?.entityId === entityId &&
        i.entityRef?.rowId === rowId
    ) ?? null
  );
}

/**
 * HTML 页面转移动作 → 状态机。纯函数：宿主拿结果决定存档/提示。
 *
 * 语义全部映射既有机器，一条都不新造：
 *   · submitWorkflow → startInstance（老区块舞台 handleSubmitToWorkflow 的
 *     同一口径：标题 = 页面语境 + 行首列值，实例挂 entityRef）。
 *     多一条守卫：同一行已有 running 实例时如实拒绝——重复提交出两个实例，
 *     审批的人不知道该批哪个。
 *   · approveWorkflow / rejectWorkflow → advanceInstance。**角色把关在这儿**：
 *     当前节点声明了 assigneeRole 且当前角色不是它 → 拒绝（fail-closed，
 *     拒绝话术把该谁处理说清楚）；没声明 → 不设卡（跟 rbac-preview 一贯语义）。
 *     分支（多出边）如实拒绝并指去工作流试运行面——在一个按钮上选走向
 *     需要 UI，这里不猜。
 */
export function applyHtmlWorkflowAction(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  ev: { kind: string; entityId: string; rowId: string | null },
  role: string | undefined,
  now: string
): WorkflowActionResult {
  const rowId = ev.rowId;
  if (!rowId) return { state, ok: false, message: "转移动作缺少当前行" };
  const row = (state.entities[ev.entityId] ?? []).find((r) => r.id === rowId);
  if (!row) return { state, ok: false, message: "这条记录不存在（可能已被删除）" };
  const rowLabel = String(Object.values(row.values)[0] ?? rowId);

  if (ev.kind === "submitWorkflow") {
    if (runningInstanceFor(state, ev.entityId, rowId)) {
      return { state, ok: false, message: `「${rowLabel}」已有进行中的流程，不能重复提交` };
    }
    const { state: next, instance } = startInstance(
      state,
      model,
      rowLabel,
      now,
      { entityId: ev.entityId, rowId }
    );
    if (!instance) {
      return { state, ok: false, message: "这个应用没有声明工作流，提交无处可去" };
    }
    return { state: next, ok: true, message: `已提交审批：${instance.title}` };
  }

  // approveWorkflow / rejectWorkflow
  const instance = runningInstanceFor(state, ev.entityId, rowId);
  if (!instance) {
    return { state, ok: false, message: `「${rowLabel}」没有进行中的流程（先提交审批）` };
  }
  const node = nodeById(model, instance.currentNodeId);
  const assignee = node?.assigneeRole;
  if (assignee && role && assignee !== role) {
    return {
      state,
      ok: false,
      message: `当前节点「${node?.name || instance.currentNodeId}」由 ${assignee} 处理，当前角色无权操作`,
    };
  }
  const action = ev.kind === "approveWorkflow" ? "approve" : "reject";
  const { state: next, error } = advanceInstance(state, model, instance.id, action, now, {
    byRole: role ?? assignee,
  });
  if (error) {
    // 目前唯一会走到这儿的是分支（多出边）：选走向需要 UI，这里不猜
    return { state, ok: false, message: `${error}——请到工作流试运行面选择走向` };
  }
  return {
    state: next,
    ok: true,
    message: action === "approve" ? `已通过：「${rowLabel}」` : `已驳回：「${rowLabel}」（流程终止）`,
  };
}
