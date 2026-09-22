/**
 * 工作台勾选已安装技能。不勾 = 已装全部进控制面目录。
 */
import React from "react";
import {
  fetchSkillCatalog,
  loadSelectedSkillSlugs,
  saveSelectedSkillSlugs,
  type SkillPackage,
} from "@/lib/skill-store-client";

export function SkillSelectBar() {
  const [installed, setInstalled] = React.useState<SkillPackage[]>([]);
  const [selected, setSelected] = React.useState<string[]>(() => loadSelectedSkillSlugs());

  React.useEffect(() => {
    let alive = true;
    void fetchSkillCatalog()
      .then(rows => {
        if (!alive) return;
        setInstalled(rows.filter(row => row.installed));
      })
      .catch(() => {
        if (alive) setInstalled([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (installed.length === 0) return null;

  function toggle(slug: string) {
    const next = selected.includes(slug)
      ? selected.filter(item => item !== slug)
      : [...selected, slug];
    setSelected(next);
    saveSelectedSkillSlugs(next);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-1 pb-1"
      data-testid="skill-select-bar"
    >
      <span className="text-[11px] text-slate-400">技能</span>
      {installed.map(skill => {
        const on = selected.includes(skill.slug);
        return (
          <label
            key={skill.id}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
              on ? "bg-[#e8eeff] text-[#3b5bdb]" : "bg-slate-100 text-slate-600"
            }`}
          >
            <input
              type="checkbox"
              className="accent-[#5b6cff]"
              checked={on}
              data-testid={`skill-select-${skill.slug}`}
              onChange={() => toggle(skill.slug)}
            />
            {skill.name}
          </label>
        );
      })}
    </div>
  );
}
