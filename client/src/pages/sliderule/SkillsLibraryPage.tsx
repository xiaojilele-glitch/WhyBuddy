/**
 * SkillsLibraryPage — 技能库（「扩展中心」的技能层）。
 *
 * 2026-07-27 下架「社区技能」层，一并移除 889 条论坛索引、855 份完整
 * SKILL.md 正文、543 份语义档案与三个采集脚本（约 11.7MB）。两个理由：
 *   1. 协议敞口——正文那批 49% 的原仓库没有 LICENSE 文件（另有 2 条
 *      GPL-3.0），当初是 owner 兜底收录；本次直接把敞口清零。
 *   2. 装了会伤产品——社区技能同样走"必须产出一条绑定真实数据模型字段
 *      的 aigc 能力"硬约束，而小红书卡片/学术论文写作/软著生成这类根本
 *      绑不上，装了要么闭环被结构门拦，要么模型硬编一个无意义能力卡。
 * 生成期的软参考通道（v5_skill_reference）保留代码不动——它设计上就是
 * 语料缺失即返回空、prompt 不加块，行为回到收录之前。
 *
 * ---
 *
 * 2026-08-26 第二次重做：四列卡片墙换成 Cursor Skills 那种**列表市场**。
 * 壳与行的来源见 marketplace-chrome.tsx。跟上一版故意不一样的三处还在：
 *
 * 1. **没有「+ 新建技能」/「Add Skill」。** 自建链路不存在。Cursor 那颗
 *    能打开创建向导；我们放一颗打不开任何东西的按钮，跟连接器层砍掉的
 *    那颗是同一个毛病。做出来那天再加。
 *
 * 2. **分类照数据里的来。** 效果图上是「金融/法律/办公协作/设计开发」，
 *    我们数据里是界面设计/内容创作/交互体验… 摆一个点进去永远是空的
 *    分类，跟摆一个连不上的连接器一样。
 *
 * 3. **没有 Popular。** 79 条里分不出哪些更热门，真要分只能瞎标一批。
 *    「全部 / 已安装」是真的。装了的技能在「全部」里只把钮翻成「已安装」，
 *    不再在同一页上面再铺一段——Cursor 也是这样，重复铺是上一版卡片墙
 *    的气味。
 *
 * ## 「添加 / 已安装」是什么
 *
 * 「安装」= 把技能语义档案落进本地已安装列表（localStorage），下次推演会
 * 注入（最多前 6 个）。跟连接器那颗「添加」**不是**一回事：连接器挂的是
 * "这一轮"，技能装的是"以后每一轮"。所以文案一个叫「已添加」、一个叫
 * 「已安装」，别对齐成同一个词。
 */

import React from "react";
import { Button, Input, message, Tooltip } from "antd";
import { Play, Sparkles } from "lucide-react";
import featuredSkills from "@/data/featured-skills.json";

import { SkillIcon } from "./skill-art/skill-icons";
import { TruncatedText } from "./TruncatedText";
import {
  MarketAddButton,
  MarketChip,
  MarketEmpty,
  MarketPage,
  MarketRow,
  MarketSearch,
  MarketViewTab,
} from "./marketplace-chrome";
import {
  channelOf,
  installKeyOf,
  installSkill,
  isInstalled,
  loadInstalledSkills,
  uninstallSkill,
  type InstalledSkill,
  type SkillChannel,
} from "./installed-skills";

interface FeaturedSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  /** 消费通道（见 installed-skills.ts）：决定装进推演后走哪条 prompt 路径 */
  channel?: SkillChannel;
  /** 绑定形状（仅 aigc 通道）：读写字段的类型，不是字段名 */
  binding?: { inputTypes: string[]; outputType: string };
}

const FEATURED = (featuredSkills as { items: FeaturedSkill[] }).items;

/** 安装键 ← → 目录项。已安装记录里没存分类，图稿要靠它反查。 */
const REPO_OF = (id: string) => `trae-market/${id}`;
const BY_REPO = new Map(FEATURED.map(f => [REPO_OF(f.id), f]));

/**
 * 通道标（2026-07-27）：装之前就说清这条技能装了会发生什么，别让用户装完
 * 才发现它绑不上任何字段。「精选」那个金标只说明来源，不说明用途，替掉。
 */
const CHANNEL_META: Record<
  SkillChannel,
  { label: string; color: string; title: string }
> = {
  aigc: {
    label: "可绑字段",
    color: "green",
    title: "装进推演后会落成一条 AIGC 能力，读写你这个应用里真实的实体字段",
  },
  experience: {
    label: "设计指导",
    color: "blue",
    title: "装进推演后影响生成的视觉与版式（配色/布局），不产出业务能力",
  },
  unbound: {
    label: "仅作参考",
    color: "default",
    title: "没验证出它能绑到哪个实体字段，只作为生成时的软参考，不发硬要求",
  },
};

function ChannelTag({ skill }: { skill: { channel?: SkillChannel } }) {
  const meta = CHANNEL_META[channelOf(skill)];
  const tone =
    meta.color === "green"
      ? "bg-emerald-50 text-emerald-700"
      : meta.color === "blue"
        ? "bg-sky-50 text-sky-700"
        : "bg-slate-100 text-slate-500";
  return (
    <Tooltip title={meta.title}>
      <span
        className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-4 ${tone}`}
        data-testid={`skill-channel-${channelOf(skill)}`}
      >
        {meta.label}
      </span>
    </Tooltip>
  );
}

const ALL = "全部";

/** 目录行（未装/已装同一行，右侧「添加 / 已安装」切换）。 */
function FeaturedRow({
  skill,
  installed,
  onToggle,
}: {
  skill: FeaturedSkill;
  installed: boolean;
  onToggle: () => void;
}) {
  return (
    <MarketRow
      testid={`featured-skill-${skill.id}`}
      attr={{ "data-installed": installed ? "1" : "0" }}
      icon={<SkillIcon category={skill.category} className="h-9 w-9" />}
      name={
        <TruncatedText
          text={skill.name}
          data-testid="skill-name"
          className="min-w-0"
        />
      }
      description={
        <TruncatedText
          text={skill.description || "（无摘要）"}
          data-testid="skill-desc"
          className="min-w-0"
        />
      }
      meta={
        <div className="flex items-center justify-end gap-1.5">
          <ChannelTag skill={skill} />
          <TruncatedText
            text={`${skill.category} · ${skill.author}`}
            data-testid="skill-meta"
            className="min-w-0"
          />
        </div>
      }
      action={
        <MarketAddButton
          testid="skill-install"
          on={installed}
          offLabel="添加"
          onLabel="已安装"
          title={installed ? "已安装，点一下卸载" : "安装（以后每轮推演都注入）"}
          onClick={onToggle}
        />
      }
    />
  );
}

/** 已安装卡：输入 → 试跑（原版 SKILL.md 走 /skill-package-tryrun，语义档案走 /aigc-tryrun） */
function InstalledSkillCard({
  skill,
  onUninstall,
}: {
  skill: InstalledSkill;
  onUninstall: (key: string) => void;
}) {
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // 试跑区默认收起（紧凑卡片；点「试跑」展开输入/输出）
  const [open, setOpen] = React.useState(false);

  const run = async () => {
    if (running || !input.trim()) return;
    setRunning(true);
    setOutput(null);
    setError(null);
    try {
      const res =
        skill.kind === "package" && skill.packageId
          ? await fetch("/api/sliderule/skill-package-tryrun", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packageId: skill.packageId, input }),
            })
          : await fetch("/api/sliderule/aigc-tryrun", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                capability: {
                  id: skill.repo.replace(/[^a-zA-Z0-9]+/g, "_"),
                  name: skill.name,
                  inputFields: ["skill.input"],
                  outputField: "skill.output",
                },
                inputs: { "skill.input": input },
                goal: `${skill.name}：${skill.description}`,
              }),
            });
      const body = res.ok
        ? ((await res.json()) as {
            ok: boolean;
            output?: string;
            code?: string;
            detail?: string;
          })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setError(
          `${body.code ?? "UNKNOWN"}${body.detail ? ` · ${body.detail.slice(0, 160)}` : ""}`
        );
      } else {
        setOutput(body.output);
      }
    } catch (e) {
      setError(`NETWORK_ERROR · ${String(e).slice(0, 160)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <MarketRow
      testid={`installed-skill-${skill.repo}`}
      open={open}
      icon={
        <SkillIcon
          category={BY_REPO.get(skill.repo)?.category}
          className="h-9 w-9"
        />
      }
      name={
        <TruncatedText
          text={skill.name}
          data-testid="skill-name"
          className="min-w-0"
        />
      }
      description={
        <TruncatedText
          text={skill.description}
          data-testid="skill-desc"
          className="min-w-0"
        />
      }
      meta={
        <div className="flex items-center justify-end gap-1.5">
          <ChannelTag skill={skill} />
          <TruncatedText
            text={skill.kind === "package" ? "原版 SKILL.md" : "语义档案"}
            className="min-w-0"
          />
        </div>
      }
      action={
        <>
          <button
            type="button"
            data-testid="installed-skill-toggle"
            onClick={() => setOpen(v => !v)}
            title="试跑：真 LLM，走服务端通道"
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-[#5b6cff]"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <MarketAddButton
            testid="skill-uninstall"
            on
            offLabel="添加"
            onLabel="卸载"
            title="卸载（只移除本地安装，不影响原仓库）"
            onClick={() => onUninstall(installKeyOf(skill))}
          />
        </>
      }
    >
      <div className="border-t border-slate-100 px-3 pb-3 pt-2">
        {skill.ioHints.length > 0 && (
          <div className="mb-1.5 space-y-0.5">
            {skill.ioHints.slice(0, 3).map(h => (
              <div key={h} className="font-mono text-[10px] text-slate-400">
                {h}
              </div>
            ))}
          </div>
        )}
        <Input.TextArea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="给这个技能输入内容，立即试跑（真 LLM，走服务端通道）"
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
        <Button
          className="mt-2"
          size="small"
          type="primary"
          icon={<Play className="h-3 w-3" />}
          loading={running}
          disabled={!input.trim()}
          onClick={run}
          data-testid="installed-skill-run"
        >
          试跑
        </Button>
        {output !== null && (
          <div className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2.5 text-xs leading-5 text-slate-700 ring-1 ring-slate-200">
            {output}
          </div>
        )}
        {error !== null && (
          <div className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 ring-1 ring-red-200">
            试跑失败：{error}
          </div>
        )}
      </div>
    </MarketRow>
  );
}

export function SkillsLibraryPage({
  /** 初始是否只看「已安装」（测试用；产品默认看全部） */
  initialMine = false,
}: {
  initialMine?: boolean;
} = {}) {
  const [category, setCategory] = React.useState(ALL);
  const [query, setQuery] = React.useState("");
  const [mineOnly, setMineOnly] = React.useState(initialMine);
  const [installed, setInstalled] = React.useState<InstalledSkill[]>(() =>
    loadInstalledSkills()
  );

  const toggleInstall = (f: FeaturedSkill) => {
    setInstalled(prev => {
      if (isInstalled(prev, REPO_OF(f.id))) {
        message.success(`已卸载「${f.name}」`);
        return uninstallSkill(prev, REPO_OF(f.id));
      }
      const next = installSkill(prev, {
        repo: REPO_OF(f.id),
        url: "",
        license: "官方市场",
        name: f.name,
        description: f.description,
        ioHints: [],
        kind: "semantic",
        channel: channelOf(f),
        ...(f.binding ? { binding: f.binding } : {}),
      });
      if (next !== prev)
        message.success(`已安装「${f.name}」，下次推演会注入，也可以直接试跑`);
      return next;
    });
  };

  const matches = React.useCallback(
    (name: string, description: string, author: string, cat?: string) => {
      if (category !== ALL && cat !== category) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        name.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        author.toLowerCase().includes(q)
      );
    },
    [category, query]
  );

  const featuredItems = React.useMemo(
    () => FEATURED.filter(f => matches(f.name, f.description, f.author, f.category)),
    [matches]
  );

  /* 已安装那一段吃同一套筛选条件——只筛一半的话，搜「配色」时上面一段
     筛过了、下面一段还是全量，看着像搜索没生效。分类靠 repo 反查目录项
     （已安装记录里不存分类）。 */
  const installedItems = React.useMemo(
    () =>
      installed.filter(s =>
        matches(s.name, s.description, s.repo, BY_REPO.get(s.repo)?.category)
      ),
    [installed, matches]
  );

  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const f of FEATURED) if (!seen.includes(f.category)) seen.push(f.category);
    /* 「全部」已经是左边那颗 view tab，分类条不再铺一颗同名的。 */
    return seen;
  }, []);

  const countOf = (cat: string) => FEATURED.filter(f => f.category === cat).length;

  return (
    <MarketPage
      testid="skills-library"
      title="技能"
      icon={<Sparkles size={18} strokeWidth={2.2} />}
      extra={
        <span className="text-[13px] text-slate-400" data-testid="skills-count">
          {FEATURED.length} 项
        </span>
      }
      search={
        <MarketSearch
          value={query}
          onChange={setQuery}
          placeholder="搜索技能 / 作者"
          testid="skills-search"
        />
      }
      tabs={
        <>
          <MarketViewTab
            testid="skills-view-all"
            label="全部"
            count={FEATURED.length}
            active={!mineOnly && category === ALL}
            onClick={() => {
              setMineOnly(false);
              setCategory(ALL);
            }}
          />
          <MarketViewTab
            testid="skills-mine"
            label="已安装"
            count={installed.length}
            active={mineOnly}
            onClick={() => setMineOnly(true)}
          />
        </>
      }
      chips={
        <div className="contents" data-testid="skills-cats">
          {categories.map(cat => (
            <MarketChip
              key={cat}
              testid="skills-cat"
              label={cat}
              count={countOf(cat)}
              active={!mineOnly && category === cat}
              onClick={() => {
                setMineOnly(false);
                setCategory(cat);
              }}
              attr={{
                "data-cat": cat,
                "data-active": !mineOnly && category === cat ? "1" : "0",
              }}
            />
          ))}
        </div>
      }
    >
      {mineOnly ? (
        <section data-testid="skills-installed">
          {installedItems.length === 0 ? (
            <MarketEmpty>
              {installed.length === 0
                ? "还没安装技能 — 切到「全部」挑一个，装完可以试跑"
                : `已安装的技能里没有匹配「${query || category}」的`}
            </MarketEmpty>
          ) : (
            <div data-testid="skills-installed-list" className="divide-y divide-slate-200/60">
              {installedItems.map(s => (
                <InstalledSkillCard
                  key={installKeyOf(s)}
                  skill={s}
                  onUninstall={key =>
                    setInstalled(prev => uninstallSkill(prev, key))
                  }
                />
              ))}
            </div>
          )}
        </section>
      ) : featuredItems.length === 0 ? (
        <MarketEmpty>{`没有匹配「${query || category}」的技能`}</MarketEmpty>
      ) : (
        <section data-testid="skills-featured">
          <div data-testid="skills-featured-list" className="divide-y divide-slate-200/60">
            {featuredItems.map(f => (
              <FeaturedRow
                key={f.id}
                skill={f}
                installed={isInstalled(installed, REPO_OF(f.id))}
                onToggle={() => toggleInstall(f)}
              />
            ))}
          </div>
        </section>
      )}
    </MarketPage>
  );
}

export default SkillsLibraryPage;
