/**
 * 完整技能包商店。目录来自服务端表，安装打 POST，不写 localStorage。
 *
 * 2026-09-20 底下是分类三列扁卡；顶栏仍走 MarketPage / 应用市场那套，
 * 不另起一种页头。上传钮没有对应链路，货架顶栏不放。
 */
import React from "react";
import { Sparkles } from "lucide-react";
import {
  MarketAddButton,
  MarketCard,
  MarketCardGrid,
  MarketChip,
  MarketEmpty,
  MarketPage,
  MarketSearch,
  MarketSection,
  MarketViewTab,
} from "./marketplace-chrome";
import { familiesPresent, groupSkillsByFamily, skillFamilyOf } from "./skill-store-layout";
import {
  fetchSkillCatalog,
  postSkillInstall,
  postSkillUninstall,
  type SkillPackage,
} from "@/lib/skill-store-client";

const ALL = "all";

export function SkillStoreGrid({
  skills,
  busy,
  onToggle,
}: {
  skills: SkillPackage[];
  busy: string | null;
  onToggle: (skill: SkillPackage) => void;
}) {
  const groups = groupSkillsByFamily(skills);
  return (
    <>
      {groups.map(group => (
        <MarketSection
          key={group.family}
          title={group.family}
          testid={`skill-store-section-${group.family}`}
        >
          <MarketCardGrid>
            {group.items.map(skill => (
              <MarketCard
                key={skill.id}
                testid={`skill-store-row-${skill.slug}`}
                icon={
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef1ff] text-[#5b6cff]">
                    <Sparkles size={15} />
                  </span>
                }
                name={skill.name}
                description={
                  <span title={skill.description}>{skill.description}</span>
                }
                action={
                  <MarketAddButton
                    on={skill.installed}
                    offLabel="+ 安装"
                    onLabel="已装"
                    title={skill.installed ? "卸载" : "安装到当前账号并开箱进沙盒"}
                    onClick={() => onToggle(skill)}
                    testid={`skill-store-install-${skill.slug}`}
                    disabled={busy === skill.id}
                  />
                }
              />
            ))}
          </MarketCardGrid>
        </MarketSection>
      ))}
    </>
  );
}

export function SkillStorePage() {
  const [query, setQuery] = React.useState("");
  const [mine, setMine] = React.useState(false);
  const [family, setFamily] = React.useState(ALL);
  const [skills, setSkills] = React.useState<SkillPackage[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setError("");
    try {
      setSkills(await fetchSkillCatalog());
    } catch {
      setError("技能目录暂时读不到。");
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const families = familiesPresent(skills);
  const visible = skills.filter(skill => {
    if (mine && !skill.installed) return false;
    if (family !== ALL && skillFamilyOf(skill) !== family) return false;
    const hay = `${skill.name} ${skill.description} ${skill.slug}`.toLowerCase();
    return !query.trim() || hay.includes(query.trim().toLowerCase());
  });

  async function toggle(skill: SkillPackage) {
    setBusy(skill.id);
    setError("");
    try {
      if (skill.installed) await postSkillUninstall(skill.id);
      else await postSkillInstall(skill.id);
      await reload();
    } catch {
      setError(skill.installed ? "卸载没写成。" : "安装没写成。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <MarketPage
      title="技能"
      icon={<Sparkles size={18} />}
      testid="skill-store-page"
      search={
        <MarketSearch
          value={query}
          onChange={setQuery}
          placeholder="搜索完整技能包"
          testid="skill-store-search"
        />
      }
      tabs={
        <>
          <MarketViewTab
            label="全部"
            count={skills.length}
            active={!mine && family === ALL}
            onClick={() => {
              setMine(false);
              setFamily(ALL);
            }}
            testid="skill-store-tab-all"
          />
          <MarketViewTab
            label="已安装"
            count={skills.filter(s => s.installed).length}
            active={mine}
            onClick={() => setMine(true)}
            testid="skill-store-tab-mine"
          />
        </>
      }
      chips={
        families.length > 1 ? (
          <div className="contents" data-testid="skill-store-cats">
            {families.map(item => (
              <MarketChip
                key={item}
                label={item}
                count={skills.filter(skill => skillFamilyOf(skill) === item).length}
                active={!mine && family === item}
                onClick={() => {
                  setMine(false);
                  setFamily(item);
                }}
                testid="skill-store-cat"
                attr={{ "data-cat": item }}
              />
            ))}
          </div>
        ) : null
      }
    >
      {error ? (
        <p className="px-2 pb-2 text-[12px] text-rose-600" data-testid="skill-store-error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="px-2 text-[12px] text-slate-400">目录加载中…</p>
      ) : visible.length === 0 ? (
        <MarketEmpty>没有完整技能包。商店不收只有描述的卡片。</MarketEmpty>
      ) : (
        <SkillStoreGrid skills={visible} busy={busy} onToggle={skill => void toggle(skill)} />
      )}
    </MarketPage>
  );
}

export default SkillStorePage;
