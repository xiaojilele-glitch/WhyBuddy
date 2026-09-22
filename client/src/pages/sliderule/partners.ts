/**
 * partners — 「伙伴」（小队）：一套预置好的能力组合 + 起手意图。
 *
 * 2026-08-25 用户要求把「扩展中心」做进同一个页面（参照豆包）。
 *
 * ## 伙伴在本产品里是什么（以及**不是**什么）
 *
 * 豆包那边的伙伴是"人设 + 预置提示词 + 预置技能"。本仓不做人设——头像和
 * 职业名是最容易造出一堆看着丰满、其实什么也不接的东西的地方，而这一整条
 * 链路的出发点正是"假的没有意义"。
 *
 * 所以这里的伙伴 = **一个真的能一键装配的组合**：
 *   - 它要用的连接器（后端 /connectors 报上来的真东西）
 *   - 它要用的技能（技能库里真的装了的）
 *   - 一句起手意图（填进输入框，用户可以再改）
 *
 * 每个伙伴的每一件依赖都会**当场核对**：连接器在不在、技能装没装。
 * 缺什么就明说缺什么（needs），不假装可用——跟 `/` 面板里"不可用的照样
 * 列出来并说明缺什么"同一个判断。
 *
 * ⚠ 内置伙伴只许引用**这个仓里真实存在**的能力。加一个引用不存在连接器的
 *   伙伴不会报错，只会让用户点了没反应——判据 partners.test.ts 里有一条
 *   专门盯着这件事。
 */

import type { SlashItem } from "./composer-slash";

export interface PartnerNeed {
  kind: "connector" | "skill";
  key: string;
  /** 人话名（列表里显示；用户没装时也要看得懂缺的是什么） */
  name: string;
}

export interface Partner {
  id: string;
  name: string;
  /** 一句话说明它替你干什么 */
  description: string;
  /** 它要用的能力 */
  needs: PartnerNeed[];
  /** 起手意图：点「用这个伙伴」时填进输入框 */
  opener: string;
  /** 内置的还是用户自己攒的 */
  builtin?: true;
}

export const BUILTIN_PARTNERS: readonly Partner[] = [
  {
    id: "weather-desk",
    name: "天气播报台",
    description: "接真实天气数据，做一个能看今天和未来一周的城市天气页",
    needs: [{ kind: "connector", key: "weather", name: "天气" }],
    opener:
      "做一个城市天气页：顶部显示今天的天气与温度，下面是未来 7 天的趋势（最高温/最低温折线）和每天的降水概率。",
    builtin: true,
  },
  {
    id: "market-desk",
    name: "行情盯盘台",
    description: "接真实 A 股行情，做一个自选股盯盘页",
    needs: [{ kind: "connector", key: "stock", name: "股票行情" }],
    opener:
      "做一个自选股盯盘页：一张表列出代码、名称、最新价、涨跌幅，按涨跌幅排序；上面放三张卡显示今日最强、最弱和平均涨跌幅。",
    builtin: true,
  },
  {
    id: "weather-market",
    name: "晨会看板",
    description: "天气 + 行情一起接，做一张出门前扫一眼的板",
    needs: [
      { kind: "connector", key: "weather", name: "天气" },
      { kind: "connector", key: "stock", name: "股票行情" },
    ],
    opener:
      "做一个晨会看板：左边是今天的天气和未来三天趋势，右边是自选股的最新价与涨跌幅，两块都要能一眼扫完。",
    builtin: true,
  },
];

export interface PartnerReadiness {
  /** 依赖是否齐全 */
  ready: boolean;
  /** 缺了什么（人话，直接显示） */
  missing: PartnerNeed[];
}

/**
 * 这个伙伴现在能不能用。
 *
 * ⚠ 判定只看"**这台机器上真的有没有**"：连接器看后端报上来的清单，
 *   技能看本地已安装。不看伙伴自己声明了什么——声明是它自己写的，
 *   当不了证据。
 */
export function partnerReadiness(
  partner: Partner,
  available: {
    connectorIds: readonly string[];
    skillKeys: readonly string[];
  }
): PartnerReadiness {
  const missing = partner.needs.filter(need =>
    need.kind === "connector"
      ? !available.connectorIds.includes(need.key)
      : !available.skillKeys.includes(need.key)
  );
  return { ready: missing.length === 0, missing };
}

/** 装配：伙伴的依赖 → 这一轮要挂的能力。缺的那些**不进去**。 */
export function partnerCapabilities(
  partner: Partner,
  available: {
    connectorIds: readonly string[];
    skillKeys: readonly string[];
  }
): SlashItem[] {
  const { missing } = partnerReadiness(partner, available);
  const missingKeys = new Set(missing.map(m => `${m.kind}:${m.key}`));
  return partner.needs
    .filter(n => !missingKeys.has(`${n.kind}:${n.key}`))
    .map(n => ({
      key: n.key,
      kind: n.kind,
      name: n.name,
      description: `来自伙伴「${partner.name}」`,
    }));
}

/* ─────────────────────────────────────────── 用户自己攒的伙伴（本地层） */

const KEY = "sliderule:partners";

function isValidNeed(raw: unknown): raw is PartnerNeed {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    (r.kind === "connector" || r.kind === "skill") &&
    typeof r.key === "string" &&
    r.key.length > 0 &&
    typeof r.name === "string"
  );
}

/** 解析存档。跟 turn-capabilities 同一条纪律：逐条验形状，脏的剔掉不抛。 */
export function readPartners(raw: string | null): Partner[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Partner[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "string" || !r.id || seen.has(r.id)) continue;
      if (typeof r.name !== "string" || !r.name) continue;
      const needs = Array.isArray(r.needs) ? r.needs.filter(isValidNeed) : [];
      seen.add(r.id);
      out.push({
        id: r.id,
        name: r.name,
        description: typeof r.description === "string" ? r.description : "",
        needs,
        opener: typeof r.opener === "string" ? r.opener : "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadPartners(): Partner[] {
  try {
    return readPartners(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function savePartners(list: readonly Partner[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储满 / 隐私模式：这一轮已经生效，只是刷新后不在了 */
  }
}

/**
 * 从"这一轮挂着的能力 + 输入框里的话"存成一个伙伴。
 *
 * ⚠ 一个能力都没挂就不许存：存出来的是个空壳，点了什么也不会发生。
 *   宁可拒绝，也不要一个看着能用、点了没反应的东西。
 */
export function partnerFromCurrent(
  name: string,
  picked: readonly SlashItem[],
  opener: string
): Partner | null {
  const trimmed = name.trim();
  const needs = picked
    .filter(p => p.kind === "connector" || p.kind === "skill")
    .map(p => ({ kind: p.kind as "connector" | "skill", key: p.key, name: p.name }));
  if (!trimmed || needs.length === 0) return null;
  return {
    id: `p-${Date.now().toString(36)}-${trimmed.length}`,
    name: trimmed,
    description: needs.map(n => n.name).join(" + "),
    needs,
    opener: opener.trim(),
  };
}
