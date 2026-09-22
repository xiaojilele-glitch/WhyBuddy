/**
 * page-panel-dedupe — 同一份数据只画一次。
 *
 * 起因是真跑逮到的：健身房应用首页把「近期出勤动态」声明了两遍——
 *
 *   page.blocks[2]  ActivityFeed  entityRef=attendance_record
 *                                 timeFieldRef=check_in_time
 *                                 levelFieldRef=status
 *   page.feeds[0]   近期出勤动态   entity=attendance_record
 *                                 timeField=…check_in_time
 *                                 levelField=…status
 *
 * 绑定逐字段相同，只有名字不同，于是两条渲染路径（体验区块脚手架 /
 * monitorDynamicLists）各画一张卡，首页出现两个一模一样的动态流。
 *
 * 根因是**结构性**的：我们的页面 schema 有五条并行声明通道
 * （stats / charts / rankings / feeds / blocks），同一个东西在哪条通道里
 * 声明都合法，没有任何一层保证它只出现一次。
 *
 * 对照 Grafana 的仪表盘 JSON 模型（官方文档 view-dashboard-json-model）：
 * 那边**只有一个扁平的 `panels` 数组**是面板的唯一来源，所有类型（stat /
 * timeseries / table…）都是这个数组里的对象，靠 `id` 保唯一——不存在"同一块
 * 内容可以从两个地方声明出来"这回事。我们短期改不动 schema（那是另一档的
 * 工程量），但可以在渲染层把那条约束补上：**先把多通道声明归一成一份带
 * 唯一键的面板清单，同键只留一个**。
 *
 * 判定用「内容指纹」而不是 id：模型给两处起了不同的 id 和名字，靠 id 永远
 * 判不出重复；真正决定"画出来是不是同一个东西"的是类型 + 绑定的实体 + 绑定
 * 的关键字段。
 *
 * 谁赢：**保留积木（block）那一份**。它带槽位摆放信息（layout.summary/
 * secondary/activity），渲染器也是新的那套（antd Card + 主题 token）；
 * legacy 的 rankings/feeds 声明只能落到固定骨架的位置上。
 */

import type {
  AppPageFeedSchema,
  AppPageRankingSchema,
} from "./app-runtime-schema";
import type { ExperienceBlockInstance } from "./block-registry";

/** 字段引用可能带实体前缀（"attendance_record.status"），比对前统一剥掉。 */
function bareField(ref: unknown): string {
  const s = String(ref ?? "").trim();
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/**
 * 面板的内容指纹：决定"画出来是不是同一个东西"的那几维。
 *
 * 故意**不含** id / 名字 / 排序方向 / 条数上限——同一份数据取前 5 名还是
 * 前 10 名、叫「即将到期会员」还是「续费提醒」，画出来仍是同一张榜，
 * 摆两张就是重复。
 */
function rankingKey(entityId: string, sortFieldId: string): string {
  return `RankedList|${entityId}|${bareField(sortFieldId)}`;
}

function feedKey(entityId: string, timeFieldId: string, levelFieldId?: string): string {
  return `ActivityFeed|${entityId}|${bareField(timeFieldId)}|${bareField(levelFieldId ?? "")}`;
}

/**
 * 不吃 binding 的两类可嵌积木的指纹（2026-08-01 补）。
 *
 * 上面两个指纹都是从 binding 推的，而 blockRef 白名单在 6fe1c13 从 2 种扩到
 * 4 种时，新增的这两种**按设计就不吃 binding**（目录原文："不使用 binding；
 * 展示哪条流程链路由 props.chainRef 声明"）——于是 blockPanelKey 对它们
 * 恒返回 null，去重直接放行，同一个积木在首页设计里嵌一次、下面骨架里再画
 * 一次。真机复现过：诊所应用 today_overview 页，设计树里嵌了
 * QuickActionPanel + WorkflowTimeline，两者在骨架里各又出现一次。
 *
 * 所以身份不能再从 binding 取，改从各自真正的内容源取：
 * - QuickActionPanel：内容全部来自 page.actions，一页里没有"第二个不同的
 *   快捷操作面板"这种东西，按类型单例即可。
 * - WorkflowTimeline：节点从 workflow 系统按 props.chainRef 解析（留空=主
 *   链路）。所以 chainRef 就是它的身份——两个指向不同链路的流程条是两个
 *   不同的东西，不该互相去重。
 */
function actionPanelKey(): string {
  return "QuickActionPanel|__page__";
}

function workflowTimelineKey(chainRef: unknown): string {
  const chain = String(chainRef ?? "").trim();
  return `WorkflowTimeline|${chain || "__main__"}`;
}

/** 积木实例/blockRef → 指纹（算不出身份的类型返回 null，不参与去重）。 */
export function blockPanelKey(
  block: Pick<ExperienceBlockInstance, "type" | "binding" | "props">
): string | null {
  // 先处理不吃 binding 的两类——它们没有 entityRef，落到下面的 entity 判空
  // 就会被当成"绑定不全"直接返回 null（这正是此前漏掉它们的原因）。
  if (block.type === "QuickActionPanel") return actionPanelKey();
  if (block.type === "WorkflowTimeline") {
    return workflowTimelineKey(
      (block.props as { chainRef?: unknown } | undefined)?.chainRef
    );
  }
  const binding = (block.binding ?? {}) as {
    entityRef?: string;
    sortByRef?: string;
    timeFieldRef?: string;
    levelFieldRef?: string;
  };
  const entity = String(binding.entityRef ?? "").trim();
  if (!entity) return null;
  if (block.type === "RankedList") {
    const sortBy = String(binding.sortByRef ?? "").trim();
    return sortBy ? rankingKey(entity, sortBy) : null;
  }
  if (block.type === "ActivityFeed") {
    const timeField = String(binding.timeFieldRef ?? "").trim();
    return timeField ? feedKey(entity, timeField, binding.levelFieldRef) : null;
  }
  return null;
}

export interface LegacyPanelLists {
  rankings: AppPageRankingSchema[];
  feeds: AppPageFeedSchema[];
}

/**
 * 把 legacy 的 rankings/feeds 里跟积木撞车的那些摘掉。
 *
 * 返回新数组；没有撞车时返回**原数组引用**，调用方可以据此跳过重渲染。
 */
export function dropLegacyPanelsCoveredByBlocks(
  lists: LegacyPanelLists,
  blocks: readonly ExperienceBlockInstance[]
): LegacyPanelLists {
  // 2026-08-03：原本还接一个 alreadyPlaced（freeform 设计树里 blockRef 摆过的
  // 指纹，"嵌了就外面不画"）。blockRef 整条通道已删除——逐行内容现在由设计
  // 模型用 rowsRef 自己画，不再有"同一份榜既在设计树里又在 page.blocks 里"
  // 这种三处并存的局面，参数随之取消。
  const taken = new Set<string>();
  for (const b of blocks) {
    const key = blockPanelKey(b);
    if (key) taken.add(key);
  }
  if (taken.size === 0) return lists;

  const rankings = lists.rankings.filter(
    r => !taken.has(rankingKey(r.entityId, r.sortFieldId))
  );
  const feeds = lists.feeds.filter(
    f => !taken.has(feedKey(f.entityId, f.timeFieldId, f.levelFieldId))
  );
  const changed =
    rankings.length !== lists.rankings.length || feeds.length !== lists.feeds.length;
  return changed ? { rankings, feeds } : lists;
}

/**
 * 积木自己内部也可能重复（模型把同一份榜声明两次）——同指纹只留第一个。
 * 指纹为 null 的（其余区块类型）一律保留，不参与去重。
 *
 * 2026-08-03：原本还接一个 alreadyPlaced（"已经在 freeform 设计树里摆过的
 * 指纹一并跳过"）。blockRef 通道已删除，设计树里不再摆现成积木，那个参数
 * 恒为空集，随之取消。
 */
export function dedupeBlocksByPanelKey(
  blocks: readonly ExperienceBlockInstance[]
): ExperienceBlockInstance[] {
  const seen = new Set<string>();
  const out: ExperienceBlockInstance[] = [];
  for (const b of blocks) {
    const key = blockPanelKey(b);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(b);
  }
  return out;
}
