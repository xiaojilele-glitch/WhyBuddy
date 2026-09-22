/**
 * 技能商店客户端。货在服务端表 + OSS，不写 sliderule:installed-skills。
 */

export type SkillPackage = {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  license?: string;
  sourceUrl?: string;
  category?: string;
  installed: boolean;
  installedAt?: string;
};

const PROJECT_KEY = "sliderule:active-project-id";
const SELECTED_KEY = "sliderule:selected-skills";

export function rememberActiveProjectId(projectId: string | null | undefined): void {
  try {
    const id = String(projectId || "").trim();
    if (!id) sessionStorage.removeItem(PROJECT_KEY);
    else sessionStorage.setItem(PROJECT_KEY, id);
  } catch {
    /* ignore */
  }
}

export function activeProjectId(): string | undefined {
  try {
    const id = sessionStorage.getItem(PROJECT_KEY)?.trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

export function loadSelectedSkillSlugs(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SELECTED_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function saveSelectedSkillSlugs(slugs: string[]): void {
  try {
    sessionStorage.setItem(SELECTED_KEY, JSON.stringify(slugs));
  } catch {
    /* ignore */
  }
}

/**
 * 输入条勾选已撤。恒不带 selectedSkills：空名单 = 已装全部进目录。
 * ⚠ 2026-09-20：旧会话 storage 里可能还留着勾过的 slug，不许再收窄 POST。
 * 这一轮点名走正文 `@slug` → mentionedSkillSlugs，不走这份存档。
 */
export function selectedSkillsDrivePayload(): string[] | undefined {
  return undefined;
}

export async function fetchSkillCatalog(): Promise<SkillPackage[]> {
  const res = await fetch("/api/sliderule/skills", { credentials: "include" });
  if (!res.ok) throw new Error(`skill_catalog_${res.status}`);
  const body = (await res.json()) as { skills?: SkillPackage[] };
  return Array.isArray(body.skills) ? body.skills : [];
}

export async function postSkillInstall(id: string): Promise<void> {
  const res = await fetch(`/api/sliderule/skills/${encodeURIComponent(id)}/install`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: activeProjectId() ?? null }),
  });
  if (!res.ok) throw new Error(`skill_install_${res.status}`);
}

export async function postSkillUninstall(id: string): Promise<void> {
  const res = await fetch(`/api/sliderule/skills/${encodeURIComponent(id)}/uninstall`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: activeProjectId() ?? null }),
  });
  if (!res.ok) throw new Error(`skill_uninstall_${res.status}`);
}
