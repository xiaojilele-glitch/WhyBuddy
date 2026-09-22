/**
 * hydrate-connectors — 推演完成后，把挂着的连接器取一次真数据填进运行时。
 *
 * ## 为什么只有一个写入点
 *
 * `seedRuntimeState` 全仓有 **6 个**调用点（studio / 应用运行屏 / 实体面板 /
 * 工作流面板 / 落地页截图 / 应用市场卡）。要是连接器取数也在每个地方接一遍，
 * 那就是仓里第四条最坏的形状——6 处里漏改任何一处都不报错，只有那个入口
 * 看到的是假数据。
 *
 * 所以取数**只做一次**：模型到位时取，取完 `saveRuntimeState` 落到这个
 * sessionId 的存档里。其余 5 个入口本来就读同一份存档，白拿。
 *
 * ## 模型里没有这张表怎么办
 *
 * 如实记成 skipped，**不往 state 里凭空塞一个实体**。塞进去不会报错，
 * 页面上也没有任何区块引用它——用户看到的是"挂了连接器但什么都没变"，
 * 而日志里却写着"成功"。宁可明说"这一轮生成的应用里没有这张表"。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { RuntimeState } from "./live-runtime";
import { applyConnectorRows } from "./connector-rows";
import type {
  ConnectorFetchResult,
  ConnectorSpec,
} from "../connectors-client";

export interface HydrateOutcome {
  applied: Array<{
    connectorId: string;
    entityId: string;
    rows: number;
    source: string;
  }>;
  /** 模型里没有这张表 —— 挂了但没落地，要说出来 */
  skipped: Array<{ connectorId: string; reason: string }>;
  /** 取数失败 —— 表绑上了但停在空态，要说出来 */
  failed: Array<{ connectorId: string; error: string }>;
}

export const EMPTY_OUTCOME: HydrateOutcome = {
  applied: [],
  skipped: [],
  failed: [],
};

function modelEntityIds(model: FiveSystemModel | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const e of model?.datamodel?.entities ?? []) {
    if (e?.id) ids.add(String(e.id));
  }
  return ids;
}

export async function hydrateConnectors(input: {
  state: RuntimeState;
  model: FiveSystemModel | null | undefined;
  connectorIds: readonly string[];
  specs: readonly ConnectorSpec[];
  /** 每个连接器的参数（用户在连接器页填过的）。缺省用 spec 里的 default。 */
  argsById?: Record<string, Record<string, string>>;
  fetchRows: (
    id: string,
    args: Record<string, string>
  ) => Promise<ConnectorFetchResult>;
}): Promise<{ state: RuntimeState; outcome: HydrateOutcome }> {
  const { state, model, connectorIds, specs, argsById, fetchRows } = input;
  const outcome: HydrateOutcome = { applied: [], skipped: [], failed: [] };
  // 纯粹省一次 Map/Set 构造——**不是**守卫：删掉它行为一模一样（循环不执行，
  // next 就是 state）。别把它当判定点，也别为它写判据（写了也咬不住）。
  if (connectorIds.length === 0) return { state, outcome };

  const known = new Map(specs.map(s => [s.id, s]));
  const inModel = modelEntityIds(model);
  let next = state;

  for (const id of connectorIds) {
    const spec = known.get(id);
    if (!spec) {
      outcome.skipped.push({ connectorId: id, reason: "这台机器上没有这个连接器" });
      continue;
    }
    if (!inModel.has(spec.entityId)) {
      // ⚠ 不往 state 里凭空塞实体，见文件头注。
      outcome.skipped.push({
        connectorId: id,
        reason: `这一轮生成的应用里没有「${spec.entityName}」这张表`,
      });
      continue;
    }
    const args =
      argsById?.[id] ??
      Object.fromEntries(spec.args.map(a => [a.id, a.default]));
    const res = await fetchRows(id, args);
    /*
     * ⚠ **失败也要 applyConnectorRows（rows 为空）。** 那一步登记的是
     *   "这张表绑了连接器"，而这个登记同时是"不许铺演示种子"的凭据。
     *   失败时跳过它的话，接下来 seedRuntimeState 会把 12 行编的数字铺上去
     *   ——用户挂了连接器，最后看到的是假数据，而且没有任何一处报警。
     */
    next = applyConnectorRows(next, spec.entityId, res.ok ? res.rows : [], {
      connector: id,
      source: res.source || spec.source,
      fetchedAt: res.fetchedAt,
    });
    if (res.ok) {
      outcome.applied.push({
        connectorId: id,
        entityId: spec.entityId,
        rows: res.rows.length,
        source: res.source,
      });
    } else {
      outcome.failed.push({ connectorId: id, error: res.error });
    }
  }
  return { state: next, outcome };
}

/** 一句话战报，给状态栏/提示条用。没挂连接器返回空串。 */
export function hydrateSummary(outcome: HydrateOutcome): string {
  const parts: string[] = [];
  for (const a of outcome.applied)
    parts.push(`${a.source} ${a.rows} 行`);
  for (const f of outcome.failed) parts.push(`取数失败：${f.error}`);
  for (const s of outcome.skipped) parts.push(s.reason);
  return parts.join("；");
}
