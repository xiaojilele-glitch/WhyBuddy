/**
 * connector-rows — 连接器取回来的真数据落进运行时状态。
 *
 * 这是"假数据不许进系统"那条产品判断在**前端**的落点。后端
 * （services/connectors.py）保证取不到就不给行；这里保证给了行之后
 * 页面上标得清楚、而且**不会被演示种子污染**。
 *
 * ## 一条硬约束，比这个文件里其它所有代码都重要
 *
 * **绑了连接器的实体永远不许铺演示种子。**
 *
 * 这是本模块最容易被后人无声破坏的地方：种子铺上去不报错、页面还更好看，
 * 只有数字是假的。所以凭据记在 state 上（connectorEntities），
 * seedRuntimeState 每次都问一遍；判据也写了正反两条——
 * "连接器实体有真行"和"把连接器行删空之后**也不许**长出种子"。
 *
 * ## 重复取数怎么合
 *
 * 按行 id 覆盖，不叠加（后端的行 id 是 (连接器, 主体, 日期) 派生的稳定值）。
 * 用户自己写进这张表的行**保留**——他写的东西不是我们的取数结果，
 * 没有权力替他删。
 */

// ⚠ ConnectorMeta 从 live-runtime 拿，**不在这里另写一份**：它是
//   RuntimeState.connectorEntities 的值类型，两处各写一份的话，加个字段
//   只改一处——这次是 tsc 当场拦下的，仓里第四条那些坑大多没这么好运。
import type { ConnectorMeta, RuntimeRow, RuntimeState } from "./live-runtime";

export type { ConnectorMeta };

export interface IncomingRow {
  id: string;
  values: Record<string, unknown>;
}

export function isLiveRow(row: RuntimeRow | null | undefined): boolean {
  return !!row?.live;
}

/** 这张表现在展示的是连接器取来的真数据吗。零行返回 false（零行是诚实空态）。 */
export function entityShowsLive(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): boolean {
  if (!state || !entityId) return false;
  const rows = state.entities[entityId];
  return Array.isArray(rows) && rows.some(isLiveRow);
}

/** 这张表的数据来历（给徽标用）。没绑连接器返回 null。 */
export function liveMeta(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): ConnectorMeta | null {
  if (!state || !entityId) return null;
  return state.connectorEntities?.[entityId] ?? null;
}

/** 绑了连接器的实体不许铺种子——seedRuntimeState 每次都问这一句。 */
export function isConnectorBound(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): boolean {
  return !!(entityId && state?.connectorEntities?.[entityId]);
}

/**
 * 把一次取数的结果落进状态。
 *
 * ⚠ **即使 rows 是空的也要记下绑定关系。** 取数失败时（后端保证 rows 为空）
 *   这张表要停在诚实空态，而不是"因为没绑上所以铺了 12 行种子"——
 *   那正好是这条链路要消灭的东西。所以绑定登记在前、写行在后，
 *   两者不共享一个 if。
 */
export function applyConnectorRows(
  state: RuntimeState,
  entityId: string,
  rows: readonly IncomingRow[],
  meta: ConnectorMeta
): RuntimeState {
  if (!entityId) return state;

  const bound = { ...(state.connectorEntities ?? {}), [entityId]: { ...meta } };

  const existing = state.entities[entityId] ?? [];
  /*
   * 留下什么、扔掉什么：
   *   - 用户自己写的行 → 留着。他写的不是我们的取数结果，没权力替他删。
   *   - 上一轮同一个连接器的行 → 整批换掉（下面按 id 覆盖）。
   *   - **演示种子 → 整批清掉。** demo-seed 自己的纪律就是"种子和真实数据
   *     绝不混在同一张表里，否则用户分不清哪条是自己写的"；真数据来了之后
   *     种子更没有理由留着。⚠ 第一版漏了这条：先铺过种子的表绑上连接器
   *     之后，12 行编的 + 7 行真的混在一张表里，而"取到了 7 行"那种判据
   *     还全绿。（跟 dropSeedRowsFor 同一个语义，只是触发点不同。）
   */
  const kept = existing.filter(
    r => !r.seed && (!r.live || r.live.connector !== meta.connector)
  );
  const incoming: RuntimeRow[] = rows.map(r => ({
    id: r.id,
    values: { ...r.values },
    createdAt: meta.fetchedAt,
    live: { ...meta },
  }));
  const byId = new Map<string, RuntimeRow>();
  for (const row of [...kept, ...incoming]) byId.set(row.id, row);

  return {
    ...state,
    entities: { ...state.entities, [entityId]: [...byId.values()] },
    connectorEntities: bound,
    /*
     * ⚠ **不要顺手往 seededEntities 里也记一笔。** 写过一版，理由是"让两本账
     *   保持一致"——结果它把真正的守卫掩护掉了：seedRuntimeState 先看
     *   seededEntities 就跳过了，`isConnectorBound` 那行变成死代码，
     *   **拆掉它判据照样全绿**（2026-08-25 变异测出来的，同一天第二次踩）。
     *   "这张表绑了连接器，不许铺种子"只留 connectorEntities 一个判定点。
     */
  };
}

/** 解除绑定（用户在这一轮摘掉了这个连接器）。行留着——已经取到的是真的。 */
export function unbindConnector(
  state: RuntimeState,
  entityId: string | null | undefined
): RuntimeState {
  if (!entityId || !state.connectorEntities?.[entityId]) return state;
  const next = { ...state.connectorEntities };
  delete next[entityId];
  return { ...state, connectorEntities: next };
}

/** 「实时 · Open-Meteo · 北京 · 21:26 取」——徽标文案。 */
export function liveBadgeText(meta: ConnectorMeta | null): string {
  if (!meta) return "";
  const t = String(meta.fetchedAt || "");
  const m = /T(\d{2}:\d{2})/.exec(t);
  const when = m ? `${m[1]} 取` : "";
  return ["实时", meta.source, when].filter(Boolean).join(" · ");
}


/* ─────────────────────────────────────────────── 徽标：从状态自己推出来 */

export interface LiveStatus {
  entityId: string;
  connector: string;
  source: string;
  fetchedAt: string;
  rows: number;
  /** 绑了连接器却一行都没有 → 页面上必须说出来（说什么看 note） */
  empty: boolean;
  note?: string;
}

/**
 * 这个应用现在接着哪些真实数据源。
 *
 * ⚠ **从 state 里推，不从"刚才那次取数的返回值"推。** 返回值只活在那一次
 *   渲染里，刷新一次就没了，而数据还在——那样用户会看到"有真数据但没有
 *   来源标注"，比没有标注更糟（他会以为这是编的）。state 是持久化的，
 *   徽标跟着数据走。
 */
export function liveStatuses(
  state: RuntimeState | null | undefined
): LiveStatus[] {
  const bound = state?.connectorEntities;
  if (!bound) return [];
  return Object.entries(bound).map(([entityId, meta]) => {
    const rows = (state?.entities?.[entityId] ?? []).filter(isLiveRow).length;
    return {
      entityId,
      connector: meta.connector,
      source: meta.source,
      fetchedAt: meta.fetchedAt,
      rows,
      empty: rows === 0,
      ...(meta.note ? { note: meta.note } : {}),
    };
  });
}

/** 一行人话。取到了说来源和行数；没取到**明说没接上**，不含糊。 */
export function liveStatusText(list: readonly LiveStatus[]): string {
  return list
    .map(s =>
      s.empty
        ? s.note || `${s.connector} 数据源没接上`
        : `${liveBadgeText(s)} · ${s.rows} 行`
    )
    .join(" · ");
}


/**
 * 把"这些实体是连接器供数的"标记上，但**不取数**（零行 + 一句说明）。
 *
 * 给只读预览用（应用市场卡片、落地页截图那类）：它们按设计不联网、不留痕，
 * 但**更不能铺演示种子**——挂了天气的应用在市场卡片里显示 12 行编出来的
 * 温度，是这条链路最丢人的失败形态：用户在自己机器上看是真的，分享出去
 * 别人看到的是假的，而两边都不报错。
 *
 * ⚠ 只标记，不写行。取数是 hydrate-connectors 的事，那里只有一个写入点。
 *
 * ⚠ **只标这个应用真有的表。** 传进来的是"注册表里所有连接器的实体 id"，
 *   跟连接器八竿子打不着的应用也会收到这份清单——不筛的话，一个待办应用
 *   会凭空挂上一枚「预览里不取实时数据」的徽标，指着一张它根本没有的表。
 *   （第一版就是这么写的，判据还把这个错的行为钉住了。）
 *   `state.entities` 的键就是模型声明的实体集（initRuntimeState 建的），
 *   拿它当筛子最直接。
 */
export function markConnectorEntities(
  state: RuntimeState,
  entityIds: readonly string[],
  note: string
): RuntimeState {
  let next = state;
  for (const id of entityIds) {
    if (!id || next.connectorEntities?.[id]) continue;
    if (!(id in (next.entities ?? {}))) continue;
    next = applyConnectorRows(next, id, [], {
      connector: id,
      source: "",
      fetchedAt: "",
      note,
    });
  }
  return next;
}
