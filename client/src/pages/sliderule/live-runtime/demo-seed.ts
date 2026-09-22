/**
 * demo-seed — 演示用种子数据（2026-07-28）。
 *
 * 为什么需要：闭环产出的应用第一次打开时每个实体都是零行，于是表格、图表、
 * KPI、体验区块全线出"暂无数据"。那是**诚实空态**，不是 bug——但对展会/试用
 * 场景来说，访客第一眼看到的是一堆空壳，辛苦生成的版式一个都读不出来。
 *
 * 边界（这四条是这个模块存在的前提，改动前先读）：
 *
 * 1. **每个实体只在"第一次遇见"时铺一次**。铺过就在状态里记一笔
 *    （seededEntities），之后哪怕被删空也不再补——用户把表清干净是明确的
 *    意图，示例数据自己长回来会让人以为数据没删掉。首次遇见时已经有真实
 *    数据的实体同样记一笔、永不铺。
 * 2. **只填完全为空的实体**。有一行真实数据的实体永远不碰——种子和真实数据
 *    绝不混在同一张表里，否则用户分不清哪条是自己写的。
 * 3. **每行都带 `seed: true` 标记**，渲染层据此出「示例数据」徽标。不做无标注
 *    的假数据：伪造得越像越该标出来。
 * 4. **用户往某实体写第一条真实数据时，该实体的种子整批清掉**
 *    （dropSeedRowsFor）。所以"新建"之后看到的就只有自己那一条。
 *
 * 确定性：值由 (实体 id, 字段 id) 派生的确定性随机流决定，不用 Math.random——
 * 同一个模型每次打开看到的示例完全一样，截图/回归可比。唯一的时间依赖是日期
 * 字段的参照点 nowMs（显式传入，单测可钉死）。
 *
 * 逼真度分三层（见 demo-seed-random.ts / -semantics.ts / -datasets.ts）：
 *   - **随机源**：pure-rand 的 xoroshiro128+，跟 drizzle-seed / fast-check 同款。
 *     第一版用 `(hash + 行号*步长) % N`，那是等差数列不是随机数，折线图画出来
 *     是直线加断崖，而且不同字段只是同一序列的相位平移。
 *   - **语义**：按字段名认出人名/机构/城市/编号/电话/邮箱，各走各的词表；
 *     认不出才退回「字段名 + 序号」。
 *   - **量纲**：enum 走声明里的真实取值（徽标颜色/看板列才对得上）、数字按
 *     format 落在合理区间（money 四位数、percent 0-100、rating 1-5）。
 */

import type { FiveSystemEntity, FiveSystemModel } from "../system-screens/five-system-model";
import { resolveRefEntityId } from "../system-screens/five-system-model";
import {
  CITIES,
  CODE_LETTERS,
  GIVEN_NAMES,
  GOODS_WORDS,
  ORG_PREFIXES,
  ORG_SUFFIXES,
  ORG_TRADES,
  SURNAMES,
} from "./demo-seed-datasets";
import { fieldRandom, type SeededRandom } from "./demo-seed-random";
import { semanticOf } from "./demo-seed-semantics";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";
import { isConnectorBound } from "./connector-rows";
import type { RuntimeRow, RuntimeState } from "./live-runtime";

/** 每个空实体铺几行。12：够触发表格分页（>10）、够排行取前 5、够趋势图有形状。 */
export const SEED_ROW_COUNT = 12;

/** 日期字段的散布跨度（天）。 */
const SEED_DATE_SPAN_DAYS = 14;

const SEED_ID_PREFIX = "seed-";

type SeedField = NonNullable<FiveSystemEntity["fields"]>[number];

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// ── 单列取值 ────────────────────────────────────────────────────────

function personName(r: SeededRandom): string {
  return `${r.pick(SURNAMES) ?? "李"}${r.pick(GIVEN_NAMES) ?? "思源"}`;
}

function orgName(r: SeededRandom): string {
  return `${r.pick(CITIES) ?? "杭州"}${r.pick(ORG_PREFIXES) ?? "恒昌"}${
    r.pick(ORG_TRADES) ?? "商贸"
  }${r.pick(ORG_SUFFIXES) ?? "有限公司"}`;
}

/** 单号：两位字母 + 年份 + 四位序数，像 `GL-2026-0317`。 */
function codeValue(r: SeededRandom, nowMs: number): string {
  const a = CODE_LETTERS[r.int(0, CODE_LETTERS.length - 1)];
  const b = CODE_LETTERS[r.int(0, CODE_LETTERS.length - 1)];
  const year = new Date(nowMs).getFullYear();
  return `${a}${b}-${year}-${String(r.int(1, 9999)).padStart(4, "0")}`;
}

function phoneValue(r: SeededRandom): string {
  // 用 13x/15x/17x/18x 这些真实号段的前缀，后 8 位随机
  const head = r.pick(["130", "133", "138", "139", "150", "156", "176", "188"]) ?? "138";
  return `${head}${String(r.int(0, 99999999)).padStart(8, "0")}`;
}

/** Fisher-Yates，用确定性随机流洗牌。 */
function shuffled<T>(items: readonly T[], r: SeededRandom): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 认不出语义的名称字段怎么填。
 *
 * 直接拼 `修饰词 + 字段名` 会写出「标准豆种名称 1」这种断掉的中文——真跑截图
 * 里就是这样，比原来的「豆种名称 1」还难读。中文里「名称/名」是**元词**，
 * 得先摘掉再修饰：豆种名称 → 豆种 → 「特级豆种」，这才是人话。
 *
 * 摘不出词干（字段名本身不以名称/名结尾）就老老实实退回「字段名 + 序号」——
 * 该合成的地方不装真。
 */
function genericName(label: string, index: number, qualifiers: readonly string[]): string {
  const stem = label.replace(/(名称|名字|名)$/, "").trim();
  if (!stem || stem === label) return `${label} ${index + 1}`;
  const q = qualifiers[index % qualifiers.length] ?? "标准";
  // 修饰词用完一轮后加序号区分，避免第 13 行起重名
  const round = Math.floor(index / qualifiers.length);
  return round === 0 ? `${q}${stem}` : `${q}${stem} ${round + 1}`;
}

/**
 * 摘要/说明这类字段的示例值。
 *
 * 跟 `text` 档共用一句模板，但**带上行序号**——12 行全是同一句话时，表格看着
 * 像渲染坏了（用户分不清是"数据一样"还是"没渲染"）。序号是最轻的区分，
 * 也不假装内容真的不同。
 */
function proseValue(label: string, index: number): string {
  return `「${label}」的示例内容 ${index + 1}，用于展示版式与信息密度。`;
}

function emailValue(r: SeededRandom, index: number): string {
  const host = r.pick(["example.com", "demo.cn", "sample.net"]) ?? "example.com";
  return `user${String(index + 1).padStart(2, "0")}@${host}`;
}

/**
 * 一列的全部取值。
 *
 * **按列生成而不是按行**：一条随机流顺序吐 count 个值，天然互不相关。
 * 若每行各开一条流，相邻行种子相近，又会退回第一版那种逐行相关的序列。
 */
function seedColumn(
  entityId: string,
  field: SeedField,
  count: number,
  nowMs: number
): unknown[] {
  const type = String(field.type ?? "string").toLowerCase();
  const label = field.name || field.id;
  const r = fieldRandom(entityId, String(field.id));
  const out: unknown[] = [];

  if (type === "enum") {
    const options = normalizeFieldOptions("enum", field.options);
    // 没有声明取值时不瞎编枚举——留空，渲染层按"未填"处理
    if (options.length === 0) return Array.from({ length: count }, () => "");
    for (let i = 0; i < count; i++) {
      // 前 options.length 行轮流铺满每个取值，保证看板每列都有货、
      // 徽标每种颜色都出现；之后再随机。纯随机在 12 行里漏掉一个取值的
      // 概率不低，漏掉就会有一列空看板。
      out.push(
        i < options.length
          ? options[i].id
          : options[r.int(0, options.length - 1)].id
      );
    }
    return out;
  }

  if (type === "number") {
    const fmt = normalizeFieldFormat("number", field.format);
    for (let i = 0; i < count; i++) {
      if (fmt === "money") out.push(r.around(6000) * 1);
      else if (fmt === "percent" || fmt === "progress") out.push(r.int(0, 100));
      else if (fmt === "rating") out.push(r.int(1, 5));
      else if (fmt === "score") out.push(r.int(60, 100));
      else out.push(r.around(120));
    }
    return out;
  }

  if (type === "date") {
    for (let i = 0; i < count; i++) {
      // 随机散布、**允许同一天有多条**。第一版用互质步长保证 12 行落 12 天，
      // 但那样 count 型趋势图每根柱子都是 1，整条线是平的。真实数据本来就
      // 有疏有密，随机散布 + 渲染层补零画出来才有形状。
      //
      // 但**最近两天必须有数据**（i < 2 时钉死 back=i）。原因是 KPI 卡的环比
      // 比的就是最后两个桶：纯随机散布下"昨天"落空的概率是 (13/14)^12 ≈ 41%，
      // 而一页的 KPI 通常共用同一个日期字段——一空全空，四成机会整屏「较前
      // 一日 —」。那不是渲染坏了（除零时如实给 null 是对的），是种子把演示
      // 数据铺成了没法比较的形状。钉住两天只占 12 行里的 2 行，趋势图的疏密
      // 形状照旧。
      const back = i < 2 ? i : r.int(0, SEED_DATE_SPAN_DAYS - 1);
      const d = new Date(nowMs);
      d.setDate(d.getDate() - back);
      out.push(localDateKey(d));
    }
    return out;
  }

  if (type === "ref") {
    // 占位，真正的取值在 resolveSeedRefs 里按目标实体**实际存在的行**回填
    return Array.from({ length: count }, () => "");
  }

  if (type === "text") {
    for (let i = 0; i < count; i++)
      out.push(`「${label}」的示例内容，用于展示版式与信息密度。`);
    return out;
  }

  // string：先按语义走词表，认不出再退回朴素形态
  const semantic = semanticOf(String(field.id ?? ""), field.name);
  // 修饰词洗一遍再按序取，保证 12 行内不重复（纯随机会撞出好几个「特级」）
  const qualifiers = shuffled(GOODS_WORDS, r);
  for (let i = 0; i < count; i++) {
    if (semantic === "person") out.push(personName(r));
    else if (semantic === "org") out.push(orgName(r));
    else if (semantic === "city") out.push(r.pick(CITIES) ?? "杭州");
    else if (semantic === "phone") out.push(phoneValue(r));
    else if (semantic === "email") out.push(emailValue(r, i));
    else if (semantic === "code") out.push(codeValue(r, nowMs));
    // 摘要/说明/建议这类要的是一句话。走跟 text 档同一句模板——**不编具体内容**，
    // 只如实说"这是示例"。编一句像模像样的经营建议，看的人会当真。
    else if (semantic === "prose") out.push(proseValue(label, i));
    else out.push(genericName(label, i, qualifiers));
  }
  return out;
}

function seedRowId(entityId: string, index: number): string {
  return `${SEED_ID_PREFIX}${entityId}-${index + 1}`;
}

/**
 * 这一行是种子吗。
 *
 * 只认 `seed` 标记，**不拿 id 前缀兜底**：种子行被用户编辑过之后
 * （updateRow 会摘掉标记）id 还是 seed-xxx，靠前缀判就会把已经装着真实
 * 输入的行继续当示例。判定权只给一个字段。
 */
export function isSeedRow(row: RuntimeRow | null | undefined): boolean {
  return row?.seed === true;
}

/** 这张表里还剩几行是种子。 */
export function seedRowCount(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): number {
  if (!state || !entityId) return 0;
  const rows = state.entities[entityId];
  return Array.isArray(rows) ? rows.filter(isSeedRow).length : 0;
}

/**
 * 这个实体现在**还在展示**种子吗——用 some 不用 every：一张表里混着 1 条
 * 真实数据 + 11 条种子时，"整表都是真的"显然不成立，徽标必须继续挂着。
 * 零行返回 false：零行是诚实空态，不是示例。
 */
export function entityShowsSeed(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): boolean {
  return seedRowCount(state, entityId) > 0;
}

/** 给一个实体造一批种子行。createdAt 也按下标回溯，动态流才有先后。 */
export function buildSeedRows(
  entity: FiveSystemEntity,
  nowMs: number,
  rawCount = SEED_ROW_COUNT
): RuntimeRow[] {
  // 夹一下行数。看着多余，其实是被咬过一口：这个函数原来的签名是
  // (entity, allEntities, nowMs)，改成 (entity, nowMs, count) 之后，漏改的
  // 调用方会把**时间戳**传到 count 上——`Array.from({length: 1.78e12})`
  // 直接把测试进程跑成 OOM，而且要等三分钟才炸，报错还完全指不到这里。
  // 上限拦住的正是这种"参数错位"，不是正常调用。
  const count = Math.max(0, Math.min(500, Math.floor(Number(rawCount) || 0)));
  const fields = (entity.fields ?? []).filter(f => f?.id);
  const columns = new Map<string, unknown[]>();
  for (const field of fields)
    columns.set(String(field.id), seedColumn(entity.id, field, count, nowMs));

  return Array.from({ length: count }, (_, i) => {
    const values: Record<string, unknown> = {};
    for (const field of fields) values[String(field.id)] = columns.get(String(field.id))![i];
    return {
      id: seedRowId(entity.id, i),
      values,
      createdAt: new Date(nowMs - i * 36e5 * 5).toISOString(),
      seed: true as const,
    };
  });
}

/**
 * 一行拿来给别人引用时显示成什么。
 *
 * 取第一个 string 字段的**实际值**——不再像第一版那样按字段定义重新推算一个
 * 名字出来。推算法有个隐患：目标实体如果没被铺种子（首次遇见时就已有真实
 * 数据），推出来的名字在那张表里根本不存在，引用就成了悬空的。
 */
function displayNameOfRow(row: RuntimeRow, entity: FiveSystemEntity): string {
  const named = (entity.fields ?? []).find(
    f => f?.id && String(f.type ?? "string").toLowerCase() === "string"
  );
  const v = named ? row.values?.[String(named.id)] : undefined;
  const s = String(v ?? "").trim();
  return s || row.id;
}

/**
 * 回填所有种子行的 ref 字段，指向目标实体**当前真实存在**的某一行。
 *
 * 运行时没有"ref 值 → 目标行显示名"的解析，值落到哪就原样打印到哪（动态流
 * 标题、看板卡、表格单元格都是），所以这里直接存解析后的显示名。
 */
function resolveSeedRefs(
  entities: Record<string, RuntimeRow[]>,
  defs: FiveSystemEntity[]
): void {
  const byId = new Map(defs.map(e => [e.id, e]));
  const allIds = defs.map(e => e.id);

  for (const def of defs) {
    const rows = entities[def.id];
    if (!Array.isArray(rows)) continue;
    const refFields = (def.fields ?? []).filter(
      f => f?.id && String(f.type ?? "").toLowerCase() === "ref"
    );
    if (refFields.length === 0) continue;

    for (const field of refFields) {
      const fieldId = String(field.id);
      // 声明优先，猜测兜底。这里自引用也认——同表挑一行的显示名照样是合法种子。
      const targetId = resolveRefEntityId(field, allIds).target;
      const targetDef = targetId ? byId.get(targetId) : undefined;
      const targetRows = targetId ? entities[targetId] : undefined;
      const r = fieldRandom(def.id, `${fieldId}#ref`);

      for (const row of rows) {
        if (!isSeedRow(row)) continue; // 只回填种子行，真实数据不碰
        if (!targetDef || !targetRows?.length) {
          // 认不出目标实体、或那张表一行都没有 → 退回朴素形态。
          // 硬编一个名字进去就成了指向不存在记录的悬空引用。
          row.values[fieldId] = `${field.name || fieldId} ${r.int(1, SEED_ROW_COUNT)}`;
          continue;
        }
        const display = displayNameOfRow(
          targetRows[r.int(0, targetRows.length - 1)],
          targetDef
        );
        row.values[fieldId] = display;
        // 冗余副本跟着对齐（2026-08-11）。
        //
        // 线上截图：同一行里「自提点: 精选自提点」而「自提点名称: 定制自提点」
        // ——两个词互相矛盾，看着像数据错了。
        //
        // 成因不是 bug 而是模型**刻意做的反规范化**：存了 `pickup_point_ref`
        // 还冗余一份 `pickup_point_name`，免得每次都去关联查。这在业务模型里
        // 是常规做法，问题只在**种子把这两个格子当成两个独立字段各填各的**。
        //
        // 反规范化副本的定义就是"跟着源走"，所以这里让它跟着 ref 的解析结果走。
        // 出处是同一条老规矩：factory_boy 的 SubFactory + SelfAttribute ——
        // 先造出被引用的对象，派生字段从**那个对象**上取，而不是另起一个随机流。
        //
        // ⚠ 只认**词干完全相同**的兄弟字段（pickup_point_ref → pickup_point_name）。
        // 模糊匹配会猜错：同一个模型里还有 `group_buy_ref` 配 `group_title`，
        // 词干对不上，这里就放过它——**宁可漏一个，不许把不相干的字段改写掉**。
        for (const sib of denormalizedSiblings(def, fieldId)) {
          if (row.values[sib] !== undefined) row.values[sib] = display;
        }
      }
    }
  }
}

/** `X_ref` 旁边那些"存一份显示名"的兄弟字段（词干必须完全相同）。 */
function denormalizedSiblings(def: FiveSystemEntity, refFieldId: string): string[] {
  const stem = refFieldId.replace(/(_ref|_id|Ref|Id)$/, "");
  if (!stem || stem === refFieldId) return [];
  const wanted = new Set([
    `${stem}_name`, `${stem}_title`, `${stem}_label`,
    `${stem}Name`, `${stem}Title`, `${stem}Label`,
  ]);
  return (def.fields ?? [])
    .map(f => String(f?.id ?? ""))
    .filter(id => wanted.has(id));
}

/**
 * 给状态铺种子。
 *
 * 每个实体只在**第一次遇见**时决定一次：那时为空就铺满，那时已有数据就永不铺。
 * 决定结果记在 `state.seededEntities` 里，所以后续把表删空也不会再长回来
 * （实测过：老实现只看"当前行数为 0"，用户删光自己的数据后重进页面，12 条
 * 示例会自己冒出来，看着像数据没删掉）。
 *
 * 幂等：判断只看标记，重复调用不会重复铺。所以三个运行时入口
 * （运行应用 / 实体数据面板 / 工作流试运行）都可以在 hydrate 时无脑调一次。
 *
 * 一行都没改时返回原对象（引用相等），避免白触发一次 re-render/持久化。
 */
export function seedRuntimeState(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  nowMs: number = Date.now()
): RuntimeState {
  const defs = (model?.datamodel?.entities ?? []).filter(e => e?.id);
  if (defs.length === 0) return state;

  const seen = { ...(state.seededEntities ?? {}) };
  let changed = false;
  const next: Record<string, RuntimeRow[]> = { ...state.entities };

  for (const entity of defs) {
    if (seen[entity.id]) continue; // 这个实体已经做过决定了
    seen[entity.id] = true;
    changed = true;
    /*
     * ⚠ 绑了连接器的实体**永远不铺**（2026-08-25，见 connector-rows.ts）。
     *
     *   种子的存在前提是"零行 = 一片空壳，展会上不好看"。那对普通实体成立；
     *   对连接器实体不成立——用户接连接器就是为了不要假数据，种子在这里正好
     *   是它要消灭的东西。取数失败时这张表必须停在**诚实空态**，页面自己会
     *   出「数据源没接上」，而不是铺 12 行编出来的漂亮数字。
     *
     *   这一条最容易被无声破坏：删掉这两行不报错、页面还更好看，只有数字是
     *   假的。判据 connector-rows.test.ts 里有正反两条钉着它。
     */
    if (isConnectorBound(state, entity.id)) continue;
    const existing = next[entity.id];
    if (Array.isArray(existing) && existing.length > 0) continue; // 已有真实数据 → 永不铺
    next[entity.id] = buildSeedRows(entity, nowMs);
  }

  if (!changed) return state;
  resolveSeedRefs(next, defs);
  return { ...state, entities: next, seededEntities: seen };
}

/**
 * 清掉某实体的种子行——用户往这张表写第一条真实数据之前调。
 *
 * 不做"保留种子、追加真实行"：两者混在一起之后，表格里哪条是自己刚写的
 * 就得靠眼力找，而「示例数据」徽标也没法再如实描述整张表。
 */
export function dropSeedRowsFor(
  state: RuntimeState,
  entityId: string | null | undefined
): RuntimeState {
  if (!entityId) return state;
  const rows = state.entities[entityId];
  if (!Array.isArray(rows) || !rows.some(isSeedRow)) return state;
  return {
    ...state,
    entities: { ...state.entities, [entityId]: rows.filter(r => !isSeedRow(r)) },
  };
}
