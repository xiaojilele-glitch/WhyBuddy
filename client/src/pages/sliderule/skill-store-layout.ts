/**
 * 技能商店货架：分类只来自索引，不打开 zip。
 *
 * 表里暂时没有 category 列。种子包的分类写在这份对照里，跟
 * skill_catalog_store 的种子 slug 对齐；接口若带了 category 就用接口的。
 * 认不出的进「其他」，不造空分类。
 */

export const SKILL_FAMILY_FALLBACK = "其他";

export const SKILL_FAMILY_BY_SLUG: Record<string, string> = {
  sliderule: "规格",
  "webapp-testing": "测试",
  "mcp-builder": "开发工具",
  "web-artifacts-builder": "开发工具",
  "frontend-design": "界面设计",
  "algorithmic-art": "界面设计",
  "brand-guidelines": "界面设计",
  "theme-factory": "界面设计",
  "canvas-design": "内容创作",
  "doc-coauthoring": "内容创作",
  "internal-comms": "办公",
  "office-skills": "办公",
  "pptx-slide-specification": "办公",
  "pptx-deck-context": "办公",
  "pptx-quality-gates": "办公",
  "file-conversion": "办公",
  study: "办公",
  "kpi-dashboard-design": "办公",
  "data-storytelling": "办公",
  accessibility: "测试",
  "web-quality-audit": "测试",
  "systematic-debugging": "开发工具",
  "verification-before-completion": "测试",
};

export const SKILL_FAMILY_ORDER = [
  "规格",
  "办公",
  "开发工具",
  "界面设计",
  "内容创作",
  "效率提升",
  "测试",
  SKILL_FAMILY_FALLBACK,
];

export function skillFamilyOf(skill: { slug: string; category?: string }): string {
  const fromIndex = String(skill.category || "").trim();
  if (fromIndex) return fromIndex;
  return SKILL_FAMILY_BY_SLUG[skill.slug] || SKILL_FAMILY_FALLBACK;
}

export function familiesPresent(skills: Array<{ slug: string; category?: string }>): string[] {
  const seen = new Set(skills.map(skillFamilyOf));
  const known = SKILL_FAMILY_ORDER.filter(family => seen.has(family));
  const extra = [...seen].filter(family => !SKILL_FAMILY_ORDER.includes(family)).sort();
  return [...known, ...extra];
}

export function groupSkillsByFamily<T extends { slug: string; category?: string }>(
  skills: T[],
): Array<{ family: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const skill of skills) {
    const family = skillFamilyOf(skill);
    const list = buckets.get(family) || [];
    list.push(skill);
    buckets.set(family, list);
  }
  return familiesPresent(skills).map(family => ({
    family,
    items: buckets.get(family) || [],
  })).filter(group => group.items.length > 0);
}
