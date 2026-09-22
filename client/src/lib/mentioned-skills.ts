/**
 * 输入框里这一轮点名的技能。`@office-skills` 是信号，不是商店勾选存档。
 *
 * ⚠ 2026-09-20：SkillSelectBar 勾选会把旧 sessionStorage 名单再收窄 POST。
 *   那条已经拆了。点名只认这一轮正文里的 `@slug`，跟勾选名单无关。
 */

const MENTION_RE = /(?<![A-Za-z0-9_])@([A-Za-z0-9][\w.-]{0,63})/g;

function normalizeSlug(raw: string): string {
  const out: string[] = [];
  for (const ch of String(raw || "").trim().toLowerCase()) {
    const mapped = /[a-z0-9]/.test(ch) ? ch : "-";
    if (mapped === "-" && out[out.length - 1] === "-") continue;
    out.push(mapped);
  }
  while (out[0] === "-") out.shift();
  while (out[out.length - 1] === "-") out.pop();
  return out.join("");
}

/**
 * 从正文抽出 `@slug`。给了 installed 就只留已装的；没给就原样留下，
 * 服务端还会再跟安装表求交。
 */
export function mentionedSkillSlugs(
  text: string,
  installed?: readonly string[]
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const src = String(text || "");
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(src))) {
    const slug = normalizeSlug(match[1] || "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    found.push(slug);
  }
  if (!installed || installed.length === 0) return found;
  const allow = new Set(
    installed.map(item => normalizeSlug(item)).filter(Boolean)
  );
  return found.filter(slug => allow.has(slug));
}
