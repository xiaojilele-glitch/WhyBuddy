"""AI 组装区块 —— 从「还没接进区块」的基础组件里，提议下一个该建的区块。

## 为什么这个动作跟「组装模板」不是一回事

用户 2026-08-08 把链路说定了：基础组件 → 区块 → 模板。两次组装，方向不同：

    组装模板：从现有区块里挑，摆进页面区域        → 产物是**数据**，能直接渲染
    组装区块：从基础组件里挑，定义一个新区块      → 产物是**契约**，还要人来实现渲染器

区别在于区块带逻辑。去 GitHub 对着 Ant Design 官方那套看得很清楚：

- `ant-design/pro-blocks` 里 29 个「区块」，每一个都是**手写的 React 源码**
  （`src/index.tsx` + `src/components/*` + `service.ts` + `_mock.ts`），
  用 `umi block add` 把源码拷进你的项目——是脚手架，不是运行时拼装。
- 真正被抽出来复用的区域级部件长这样（这是官方自己的拆法）：
  IntroduceRow（指标卡那一排）、ChartCard（title/action/total/图/footer 五个槽）、
  Trend（环比涨跌）、SalesCard（带页签和时间范围的图表卡）、TopSearch（排行）、
  StandardFormRow + TagSelect（标签式筛选，可展开）、ListToolBar（标题+搜索+
  操作+页签+轻筛选）、Table Alert（已选 N 项 / 清空 / 批量操作）、
  ColumnSetting（列设置）、TableForm（可编辑子表）。

  每一个都是 **schema + 逻辑 + 关联**，跟用户说的区块定义一字不差。

所以这里让模型做的**不是**生成代码，是做设计：看着还没被用上的素材，说出
「还缺哪个区块、它收什么、绑什么、该落在哪些区域、为什么值得建」。产出是一份
提案，实现仍然是写代码——这跟 antd 自己的做法一致，也是唯一诚实的做法。

## 为什么值得让 AI 做这件事

对完账之后有个明摆着的数字：139 个基础组件，只有 21 个被区块用上，118 个躺着。
那 118 个不是没用，是**没人想过它们能组成什么业务区块**。这正好是模型擅长的
组合搜索，而且有硬判据可以卡（见 gate）：提案必须真的释放没被用过的素材，
否则它只是把已有区块换个名字。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from services import schema_legal as L
from services.page_archetypes import PAGE_ARCHETYPES

# 区域能接受的能力面 —— 提案的 capability 必须落得进至少一个区域，
# 否则这个区块建出来也没有页面位置放它。
REGION_CAPABILITIES = {
    cap
    for arch in PAGE_ARCHETYPES.values()
    for region in arch["regions"]
    for cap in region["accepts"]
}
REGION_KEYS = {
    region["key"] for arch in PAGE_ARCHETYPES.values() for region in arch["regions"]
}

MIN_PROPOSALS = 1
MAX_PROPOSALS = 3

# ── prompt 里那个"合格样例"的名字 ────────────────────────────────────────
#
# 样例必须是**还不存在**的区块：拿现有区块当样例，模型会照抄，然后被
# duplicate-block 判死，白烧一轮。
#
# 这里踩过两次同一个坑，坑法一模一样——先挑一个"看起来还不存在"的名字写死，
# 过些天那个区块真建出来了，用例当场红：
#
#   2026-08-08  BatchActionBar        建成真区块
#   2026-08-08  ColumnSettingPanel    建成真区块（②批次 1 第一个）
#
# 所以不再写死。候选按顺序取第一个**目录里没有**的，路线图上排得越靠后越
# 安全。全被建完了也不会崩：回落到一个明确的占位名。
_EXAMPLE_CANDIDATES = (
    "ColumnSettingPanel",
    "DragSortHandleBar",
    "PivotSummaryRow",
    "CrossSheetFieldPanel",
)
_EXAMPLE_FALLBACK = "SomeBlockYouInvent"


def example_block_type() -> str:
    """prompt 样例用的区块名 —— 保证不与目录里已有的区块重名。"""
    taken = {str(b["type"]) for b in L.EXPERIENCE_BLOCKS}
    for name in _EXAMPLE_CANDIDATES:
        if name not in taken:
            return name
    return _EXAMPLE_FALLBACK


def existing_blocks() -> List[Dict[str, Any]]:
    """现有区块的契约摘要 —— 给模型看"已经有什么"，免得提重复的。"""
    out = []
    for b in L.EXPERIENCE_BLOCKS:
        bs = b.get("bindingSchema") or {}
        out.append({
            "type": str(b["type"]),
            "capability": b.get("capability"),
            "does": b.get("description", ""),
            "binds": list(bs.get("required", [])),
        })
    return out


def _prompt(
    unlinked: List[Dict[str, Any]], linked: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    system = (
        "You design business BLOCKS for an app builder. A block is a region-sized unit "
        "of a page — not a component, not a whole page. It is built out of base UI "
        "components and carries its own data binding, its own logic, and a declared "
        "capability so the page assembler knows which region it belongs in.\n"
        "Ant Design's own library factors pages this way: IntroduceRow (a row of metric "
        "cards with period-over-period trend), ListToolBar (title + search + actions + "
        "tabs), table Alert (N selected / clear / bulk actions), StandardFormRow + "
        "TagSelect (tag-style filters that expand). Aim at that granularity."
    )

    user = (
        "BASE COMPONENTS NOT YET USED BY ANY BLOCK — this is the material you are here "
        "to put to work:\n"
        + json.dumps(unlinked, ensure_ascii=False, indent=1)
        + "\n\nBASE COMPONENTS ALREADY IN USE (you may reuse them, but a proposal made "
        "ONLY of these releases nothing):\n"
        + json.dumps([c["name"] for c in linked], ensure_ascii=False)
        + "\n\nBLOCKS THAT ALREADY EXIST — do not propose these again, and do not "
        "propose a renamed variant of one:\n"
        + json.dumps(existing_blocks(), ensure_ascii=False, indent=1)
        + "\n\nCAPABILITIES a block may declare (a region accepts blocks by capability; "
        "pick the one that matches what the block DOES):\n"
        + json.dumps(sorted(REGION_CAPABILITIES), ensure_ascii=False)
        + "\n\nPAGE REGIONS a block can land in:\n"
        + json.dumps(sorted(REGION_KEYS), ensure_ascii=False)
        + f"\n\nRULES\n"
        f"1. Propose {MIN_PROPOSALS} to {MAX_PROPOSALS} blocks. Fewer good ones beats "
        "more thin ones.\n"
        "2. Every proposal MUST use at least one base component from the unused list. "
        "That is the point of the exercise.\n"
        "3. 'uses' must be exact names from the lists above. Never invent a component.\n"
        "4. Say what it BINDS to — a block with no binding is decoration, not a block. "
        "Use generic slot names (entityRef, fieldRefs, statusField, ...), not real "
        "field ids: this is a contract, it has no data model yet.\n"
        "5. 'why' must name the concrete page situation that is badly served today "
        "(in Chinese, one sentence). 'because it would be nice' is not a reason.\n"
        "6. Names in Chinese for 'label', PascalCase English for 'type'.\n\n"
        "Return JSON only:\n"
        # 名字从 example_block_type() 来，保证跟目录里的区块不重名（见那里的说明）
        + json.dumps(
            {
                "proposals": [{
                    "type": example_block_type(),
                    "label": "示例区块",
                    "capability": "action",
                    "does": "一句话说清它替用户做成了什么",
                    "uses": ["Checkbox", "Button", "Space"],
                    "regions": ["main", "header"],
                    "props": ["title", "actions"],
                    "binding": {"required": ["entityRef"], "optional": ["fieldRefs"]},
                    "why": "这里写那个今天被服务得很差的具体页面处境",
                }]
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def gate(
    parsed: Dict[str, Any], base_names: set[str], unlinked_names: set[str]
) -> List[Dict[str, str]]:
    """提案检查。返回 findings，空 = 通过。

    跟页面 Gate 同一个立场：这些错都有明确特征，规则一查一个准，不需要再让
    一个聪明模型凭感觉判。而且 findings 能直接回喂让下一轮修。
    """
    findings: List[Dict[str, str]] = []
    proposals = parsed.get("proposals")
    if not isinstance(proposals, list) or not proposals:
        return [{"code": "no-proposals", "why": "没有给出任何提案"}]
    if len(proposals) > MAX_PROPOSALS:
        findings.append({
            "code": "too-many",
            "why": f"给了 {len(proposals)} 个提案，最多 {MAX_PROPOSALS} 个——"
                   "宁可少而准",
        })

    existing_types = {b["type"] for b in existing_blocks()}
    seen: set[str] = set()

    for p in proposals:
        if not isinstance(p, dict):
            findings.append({"code": "bad-proposal", "why": "提案不是一个对象"})
            continue
        t = str(p.get("type") or "").strip()
        if not t:
            findings.append({"code": "no-type", "why": "有个提案没有 type"})
            continue

        if t in existing_types:
            findings.append({
                "code": "duplicate-block",
                "why": f"{t} 已经是现有区块了，换一个真正缺的",
            })
        if t in seen:
            findings.append({"code": "duplicate-block", "why": f"{t} 在这一批里重复了"})
        seen.add(t)

        uses = p.get("uses")
        if not isinstance(uses, list) or not uses:
            findings.append({"code": "no-uses", "why": f"{t} 没说它用哪些基础组件"})
            uses = []
        bad = [u for u in uses if str(u) not in base_names]
        if bad:
            findings.append({
                "code": "unknown-base-component",
                "why": f"{t} 用到了不存在的基础组件 {bad}——只能用清单里的",
            })
        # 这条是这套东西成不成立的判据：提案要是全用已经接进区块的素材，
        # 那 118 个还是 118 个，白提。
        if uses and not (set(map(str, uses)) & unlinked_names):
            findings.append({
                "code": "no-new-coverage",
                "why": f"{t} 用的全是已经接进区块的组件，一个没用过的素材都没释放",
            })

        cap = str(p.get("capability") or "")
        if cap not in REGION_CAPABILITIES:
            findings.append({
                "code": "unknown-capability",
                "why": f"{t} 的 capability「{cap}」不在能力面里，没有区域会收它",
            })

        regions = p.get("regions")
        if not isinstance(regions, list) or not regions:
            findings.append({"code": "no-regions", "why": f"{t} 没说它落在哪些区域"})
        else:
            bad_r = [r for r in regions if str(r) not in REGION_KEYS]
            if bad_r:
                findings.append({
                    "code": "unknown-region",
                    "why": f"{t} 说要落在不存在的区域 {bad_r}",
                })

        binding = p.get("binding")
        required = (binding or {}).get("required") if isinstance(binding, dict) else None
        if not required:
            findings.append({
                "code": "no-binding",
                "why": f"{t} 没有必填绑定——不绑数据的不是区块，是装饰",
            })

        if not str(p.get("why") or "").strip():
            findings.append({
                "code": "no-why",
                "why": f"{t} 没说清它解决的是哪个具体场景",
            })
        if not str(p.get("does") or "").strip():
            findings.append({"code": "no-does", "why": f"{t} 没有说明"})

    return findings


def propose_blocks(
    base_components: List[Dict[str, Any]], max_retries: int = 1
) -> Dict[str, Any]:
    """从基础组件提议新区块。

    `base_components` 由前端传来 —— 基础组件目录是 TSX（每条带一个真实的
    render），没法搬到 Python 侧，所以让持有 SSOT 的那一边把名字、分组、
    说明和「被哪些区块用了」一起送过来。
    """
    from sliderule_llm.client import LlmError, call_llm_json_with_shape

    base_names = {str(c.get("name")) for c in base_components if c.get("name")}
    unlinked = [c for c in base_components if not c.get("usedBy")]
    linked = [c for c in base_components if c.get("usedBy")]
    unlinked_names = {str(c["name"]) for c in unlinked}

    if not unlinked:
        return {
            "ok": False,
            "error": "没有「还没接进区块」的基础组件了——没有素材可以释放",
        }

    messages = _prompt(unlinked, linked)
    last_findings: List[Dict[str, str]] = []

    for attempt in range(max_retries + 1):
        try:
            parsed, _ = call_llm_json_with_shape(
                messages, required_keys=("proposals",), max_shape_retries=1
            )
        except LlmError as exc:
            return {"ok": False, "error": f"模型没能给出可用的提案：{str(exc)[:160]}"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"提议失败：{str(exc)[:160]}"}

        findings = gate(parsed, base_names, unlinked_names)
        if not findings:
            proposals = parsed["proposals"]
            return {
                "ok": True,
                "proposals": proposals,
                "gatePassed": True,
                "attempts": attempt + 1,
                # 这一批要是都建了，覆盖缺口会从多少降到多少 —— 提案的价值
                # 得能被量出来，不然只是一段好听的话。
                "releases": sorted(
                    {
                        u
                        for p in proposals
                        for u in p.get("uses", [])
                        if str(u) in unlinked_names
                    }
                ),
                "unlinkedBefore": len(unlinked),
            }
        last_findings = findings
        if attempt < max_retries:
            messages = messages + [
                {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                {
                    "role": "user",
                    "content": "这一版没过检查，逐条修掉再给一版完整 JSON：\n"
                    + "\n".join(f"- [{f['code']}] {f['why']}" for f in findings),
                },
            ]

    return {
        "ok": False,
        "error": "提案没通过检查",
        "findings": last_findings,
        "attempts": max_retries + 1,
    }
