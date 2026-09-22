"""技能库分诊：128 条逐个判定「能不能绑成一条 aigc 能力」。

    ./.venv/bin/python scripts/triage_skills.py              # 全量
    ./.venv/bin/python scripts/triage_skills.py --rules-only # 只跑规则层，不调 LLM
    ./.venv/bin/python scripts/triage_skills.py --limit 20   # 抽样试跑

背景：装一个技能不是"加个参考"，是给生成加硬约束——
    User-installed skills (REQUIRED: for EACH one below, include a matching
    entry in aigc.capabilities with inputFields/outputField bound to real
    datamodel entity fields of this app)
而结构门硬校验这些绑定，解析不到真实字段就报 DANGLING 拦截
（v5_model_gate.py:736 起）。所以库里但凡绑不上的技能，装了只有两种结果：
闭环被拦，或者模型硬编一个无意义绑定混过门——两者都比不装更糟。

判定标准直接对着契约来（builtin_domain_models.json 的真实形状）：
    {"id","name","inputFields":["entity.field",…],"outputField":"entity.field","roleRefs":[…]}
一条能力 = 读若干业务实体字段 → 写回一个业务实体字段。据此三分：

  keep     能表述成上面这个形状（合同审查：读合同正文 → 写风险条款）
  reroute  是生成期的风格/结构指导，不是业务能力（配色方案、空态文案）
           —— 不该走 aigc 硬契约，应改走体验层通道
  drop     写代码/发布/运维的开发者技能（gh-cli、redis-development）
           —— 在生成出来的业务系统里没有任何对应物

**本脚本只出报告，不改任何数据文件。**下架/改通道是产品决策，要人看过再动手。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

from sliderule_llm.config import default_max_tokens  # noqa: E402

load_dotenv(_ROOT.parent / ".env")
load_dotenv(_ROOT / ".env", override=False)

SKILLS = _ROOT.parent / "client" / "src" / "data" / "featured-skills.json"
OUT_JSONL = _ROOT.parent / "docs" / "skills-triage.jsonl"

VERDICTS = ("keep", "reroute", "drop", "unknown")

# ── 规则层：只处理"闭眼都知道"的，其余交给 LLM ────────────────────
# 纪律与 intake_judge 一致：确定性层高精度优先，宁可交给下一层，也不硬判。

# 写代码/发布/运维的开发者技能。命中即 drop——生成出来的业务系统里没有
# "执行 git 提交""部署 CDN""构建 MCP 服务器"这种实体字段可绑。
_DROP_PATTERNS = [
    (r"\b(git|gh)-|\bgit\b|提交规范", "版本控制/Git 工具"),
    (r"\b(cli|sdk|npm|pnpm|webpack|vite)\b", "命令行/构建工具链"),
    # 收紧：裸 pages\b 会把散文里的"document pages""presentation pages"
    # 当成 GitHub Pages 部署，误伤 doc-page/ppt-page/report-page 三条真的
    # 内容产出技能。要求 pages 前面带托管平台名；真部署技能自带"部署/cdn"。
    (r"部署|deploy|cdn|serverless|\b(github|gh|cloudflare|vercel|edge)[ -]pages\b", "部署/发布"),
    # 收紧：裸 \bmcp\b 会命中"通过 MCP 获取…"这种把 MCP 当传输层用的技能
    # （figma），而规则想抓的是"开发 MCP 服务器"本身。
    (r"mcp-builder|构建.{0,6}mcp|mcp\s*服务器|building\s+mcp", "MCP 服务器开发"),
    # 收紧：光一个"测试"字会误伤需求分析类技能（edge-case-hunter 的描述里
    # 有"输出测试清单"，它是设计期辅助不是开发工具）。要求出现测试框架/
    # 工程语境才算。
    (r"playwright|e2e\b|单元测试|集成测试|测试框架|自动化测试", "测试工具"),
    (r"\b(react|vue|redis|postgres|next\.?js|react-native)\b", "具体技术栈开发规范"),
    (r"代码审查|code.?review|security-best|安全审查", "代码审查"),
    (r"调试|debug|profil|性能优化.*代码", "调试/性能"),
]

# 生成期的视觉/结构指导。它们产出的是"这一页该长什么样"，不是某个业务
# 实体字段的值——走 aigc 硬契约是通道错配，应改挂体验层。
_REROUTE_CATEGORIES = {"页面设计", "色彩搭配", "布局排版", "交互体验", "界面设计"}
_REROUTE_PATTERNS = [
    (r"配色|色板|palette|对比度|wcag", "配色方案"),
    (r"排版|布局|layout|栅格|间距|密度", "版式/布局"),
    (r"空态|empty.?state|骨架屏|加载态", "状态设计"),
    (r"导航|navigation|信息架构", "导航结构"),
    (r"动效|动画|transition|微交互", "动效"),
]

# 业务能力的强信号：读业务数据 → 产出判断/评分/结构化结果。
_KEEP_PATTERNS = [
    # 收紧：光一个"审查"会误伤设计期技能（workflow-gap-finder"审查业务流程
    # 完整性"审的是流程设计，不读任何业务记录字段，绑不上）。要求审查的
    # 对象是具体业务单据。
    (r"(合同|发票|单据|资质|报销|工单|简历|病历|条款)\s*(审查|审核|核验)", "审查类"),
    (r"筛选|匹配度|推荐理由", "筛选匹配类"),
    (r"评估|评分|打分|风险等级", "评估打分类"),
    (r"预测|预警|异常检测", "预测预警类"),
    # 收紧：裸"结构化"命中的是"结构化计划""结构化协作流程""结构化缺陷
    # 报告"这类修饰语，把 writing-plans/executing-plans/dogfood 误判成业务
    # 能力——它们读的是开发流程或运行中的应用，不是业务实体字段。要求
    # 抽取/提取的对象出现在同一句里。
    (r"(抽取|提取)(信息|字段|要素|数据|内容|实体)|信息抽取|字段提取", "信息抽取类"),
    # 收紧：裸"摘要"会命中"支持视图、过滤、公式和摘要"（obsidian-bases 的
    # 功能罗列）。要求摘要的对象是记录/数据/内容。
    (r"(摘要|归纳|总结).{0,6}(记录|数据|内容|报告|周期)|自动写成.*摘要", "摘要类"),
]


def _rule_verdict(skill: dict) -> tuple[str, str] | None:
    """规则层判定。返回 (verdict, 依据) 或 None（交给 LLM）。"""
    blob = f"{skill['name']} {skill['description']}".lower()
    for pattern, label in _DROP_PATTERNS:
        if re.search(pattern, blob, re.IGNORECASE):
            return "drop", f"规则:开发者工具({label})"
    if skill.get("category") in _REROUTE_CATEGORIES:
        return "reroute", f"规则:设计指导(分类={skill['category']})"
    for pattern, label in _REROUTE_PATTERNS:
        if re.search(pattern, blob, re.IGNORECASE):
            return "reroute", f"规则:设计指导({label})"
    for pattern, label in _KEEP_PATTERNS:
        if re.search(pattern, blob, re.IGNORECASE):
            return "keep", f"规则:业务能力({label})"
    return None


# ── LLM 层：规则判不了的，对着真实契约问 ──────────────────────────

_CONTRACT_EXAMPLE = json.dumps(
    {
        "id": "purchase_risk_assessment",
        "name": "采购风险评估",
        "inputFields": ["purchase_order.total_amount", "supplier.qualification_status"],
        "outputField": "purchase_order.risk_level",
        "roleRefs": ["manager"],
    },
    ensure_ascii=False,
)

_SYSTEM = f"""你在给一个「AI 生成业务系统」产品的技能库做分诊。

用户装了技能之后，生成时会被硬性要求：为每个已装技能产出一条 aigc 能力，
且输入/输出字段必须绑定到该应用真实数据模型的实体字段上，绑不上会被结构门
拦截。一条合法能力长这样：

{_CONTRACT_EXAMPLE}

也就是说，一条能力 = 读若干业务实体字段 → 写回一个业务实体字段。

给你一个技能的名称与描述，判断它属于哪一类：

- keep：能表述成上面那个形状。例：合同审查（读合同正文字段 → 写风险条款字段）、
  简历筛选（读岗位要求+简历字段 → 写匹配度字段）。
- reroute：是生成期的视觉/结构/文案风格指导，产出的是"页面该长什么样"，
  不是某个业务实体字段的值。例：配色方案生成、空态文案设计。
- drop：是给写代码的开发者/编码 Agent 用的技能，在生成出来的业务系统里
  没有任何对应物。例：Git 提交规范、Redis 开发最佳实践、CDN 部署。

输出严格 JSON，不要解释文字或代码块标记：
{{"verdict": "keep|reroute|drop", "reason": "一句中文，说明依据"}}

判定纪律：拿不准优先判 drop 或 reroute——错留一个绑不上的技能，代价是用户
装了之后闭环被拦或长出无意义能力卡；错删一个，只是少一个候选。"""


def _llm_verdict(skill: dict) -> tuple[str, str]:
    from sliderule_llm.structured import structured_llm_json

    payload = structured_llm_json(
        [
            {"role": "system", "content": _SYSTEM},
            {
                "role": "user",
                "content": f"名称：{skill['name']}\n描述：{skill['description']}\n"
                f"现有分类：{skill.get('category', '')}\n作者：{skill.get('author', '')}",
            },
        ],
        required_keys=("verdict", "reason"),
        temperature=0.0,
        max_tokens=default_max_tokens(),
        max_retries=1,
    )
    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in ("keep", "reroute", "drop"):
        raise ValueError(f"verdict 非法: {verdict[:30]!r}")
    return verdict, f"LLM:{str(payload.get('reason') or '')[:70]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rules-only", action="store_true", help="只跑规则层，不调 LLM")
    ap.add_argument("--limit", type=int, help="只处理前 N 条（抽样试跑）")
    args = ap.parse_args()

    items = json.loads(SKILLS.read_text(encoding="utf-8"))["items"]
    if args.limit:
        items = items[: args.limit]
    print(f"技能 {len(items)} 条\n")

    rows = []
    for i, skill in enumerate(items, 1):
        hit = _rule_verdict(skill)
        if hit is not None:
            verdict, why = hit
        elif args.rules_only:
            verdict, why = "unknown", "规则未命中（--rules-only 未调 LLM）"
        else:
            try:
                verdict, why = _llm_verdict(skill)
            except Exception as exc:  # noqa: BLE001 — 判不了就如实标 unknown，不猜
                verdict, why = "unknown", f"LLM 失败: {type(exc).__name__}"
            print(f"  [{i}/{len(items)}] {skill['name'][:34]:36} → {verdict}")
        rows.append(
            {
                "id": skill.get("id"),
                "name": skill["name"],
                "author": skill.get("author"),
                "category": skill.get("category"),
                "verdict": verdict,
                "why": why,
                "description": skill["description"][:120],
            }
        )

    counts = Counter(r["verdict"] for r in rows)
    print(f"\n{'═' * 68}")
    print(f"{'保留（可绑成 aigc 能力）':28} {counts['keep']:>4}")
    print(f"{'改通道（设计指导→体验层）':28} {counts['reroute']:>4}")
    print(f"{'下架（开发者工具）':28} {counts['drop']:>4}")
    if counts["unknown"]:
        print(f"{'待人工判定':28} {counts['unknown']:>4}")

    for verdict, title in (
        ("drop", "下架清单"),
        ("reroute", "改通道清单"),
        ("keep", "保留清单"),
        ("unknown", "待人工判定"),
    ):
        group = [r for r in rows if r["verdict"] == verdict]
        if not group:
            continue
        print(f"\n── {title}（{len(group)}）" + "─" * 40)
        for r in sorted(group, key=lambda x: (x["author"] or "", x["name"])):
            print(f"  {r['name'][:36]:38} [{r['category']}] by {r['author']}")
            print(f"      {r['why']}")

    # 作者 × 判决交叉，看两批来源是不是各自成堆（分诊结论的稳健性自检）
    print(f"\n── 来源 × 判决 " + "─" * 46)
    origins = sorted({("WhyBuddy 自产" if r["author"] == "WhyBuddy" else "外部厂商") for r in rows})
    print(f"  {'来源':14} {'keep':>6} {'reroute':>8} {'drop':>6} {'unknown':>8}")
    for origin in origins:
        sub = Counter(
            r["verdict"]
            for r in rows
            if ("WhyBuddy 自产" if r["author"] == "WhyBuddy" else "外部厂商") == origin
        )
        print(
            f"  {origin:14} {sub['keep']:>6} {sub['reroute']:>8} {sub['drop']:>6} {sub['unknown']:>8}"
        )

    # 抽样/仅规则跑不许覆盖正式报告——真实事故：--limit 5 试跑一次，把已经
    # 跑好的 128 行结论冲成了 5 行。部分结果另存，正式报告只由全量跑产出。
    partial = bool(args.limit) or args.rules_only
    out = OUT_JSONL.with_suffix(".partial.jsonl") if partial else OUT_JSONL
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    note = "（部分结果，未覆盖正式报告）" if partial else "（仅报告，未改任何数据文件）"
    print(f"\n明细 → {out.relative_to(_ROOT.parent)}{note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
