"""目录窄化：按题意从 358 个区块里挑一小批注进 prompt，而不是全量倒进去。

## 为什么要窄化（实测，不是猜）

2026-08-10 用 scripts/block_selection_metrics.py 量过：目录 358 个通电区块，
control 臂 10 趟共 136 次选中，其中来自原名次 >52 的只有 **2 次（1.5%）**，
而 >52 的区块占目录 **306/358（85%）**。三个竞争解释被逐一排除（PROVEN
LAYOUTS 措辞、模型排斥冷门件、描述缺失），剩下位置/可达性：把原第 279 名的
OnCallScheduleCalendar 挪到第 15 位，同题三趟从 0/3 变 3/3——同样的字数、
同样的描述，只换了位置（见 schema_legal._promote_blocks_for_experiment 头注）。

这不是本仓库特有的怪癖。业界把它叫 "too many tools"，机制是 RoPE 的
long-term decay：候选排在长清单中段时被选中的概率显著低于排在开头。通行解法
就是**先检索出一小批、再放在靠前位置注入**（Tool RAG）。

## 为什么按召回优先、而且必须保底

arXiv 2605.24660（How Many Tools Should an LLM Agent See?）实测两点，都直接
影响这里的取数：

  · 候选**越多**选得越差：BFCL 上 2 条候选时选对 93.1%，5 条时降到 87.1%；
  · 但固定砍到 5 条时，难题上"一条都没找着"——正确答案排在第 6~20 位。

所以窄化不是"越窄越好"，是**在可达区里塞进尽可能高的召回**。默认取 60 —— 比
论文里单次工具选择的 7 条大得多，因为这里一次要为 5~7 个页面选材，不是选一个
工具调用。

## 硬约束：预设点名的区块必须无条件在集合里

PROVEN LAYOUTS 那 10 档预设点名了 MetricGrid / DataTable / RecordFormDialog
等 10 个区块，prompt 里还写着"从这些起手"。要是窄化把它们筛掉了，prompt 就
自相矛盾（叫你用某个件、目录里却没有），大概率直接被结构门拒收。所以它们
**不参与竞争**，先无条件进集合，再用剩余额度装按题意检索出来的。

## 检索实现

BM25（rank_bm25，numpy-only）+ 意图词表展开 + 字段加权 + generality 加成。
四样都对齐 client/src/pages/sliderule/component-search.ts —— 那是同一个判断的
另一个消费方（用户在组件库里敲字搜索），它有 17 条查询的 Recall@k 判定清单。
意图词表与字段权重走**同一份 JSON**（services/data/block_intent_lexicon.json），
不各写一份。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from . import env_flags as _env_flags

#: 已经喊过的告警，喊一次就够——这条路每次生成都会走，不去刷屏。
_WARNED: set = set()


def _warn_once(message: str) -> None:
    if message in _WARNED:
        return
    _WARNED.add(message)
    import sys

    print(message, file=sys.stderr, flush=True)


_LEXICON_FILE = Path(__file__).resolve().parent / "data" / "block_intent_lexicon.json"

#: 单字汉字：查询侧丢掉（见 tokenize_query）
_SINGLE_CJK_RE = re.compile(r"^[一-龥]$")
_ASCII_RE = re.compile(r"[a-z0-9]+")
_CAMEL_RE = re.compile(r"[A-Z][a-z0-9]+")
_CJK_RUN_RE = re.compile(r"[一-龥]+")


def _load_lexicon() -> Dict[str, Any]:
    raw = json.loads(_LEXICON_FILE.read_text(encoding="utf-8"))
    rules = []
    for r in raw.get("intentLexicon") or []:
        flags = re.IGNORECASE if "i" in str(r.get("flags") or "") else 0
        rules.append((re.compile(str(r["pattern"]), flags), str(r["terms"])))
    return {"rules": rules, "fieldWeights": raw.get("fieldWeights") or {}}


_LEXICON = _load_lexicon()


def tokenize(text: str) -> List[str]:
    """索引侧分词：ASCII 整词 + 驼峰拆分 + 汉字单字与相邻二字。

    与 component-search.ts 的 tokenize 同构（那边有实测依据的注释）。单字保留是
    真实需求（搜「表」要命中「表格」）。
    """
    out: List[str] = []
    out += _ASCII_RE.findall((text or "").lower())
    out += [w.lower() for w in _CAMEL_RE.findall(text or "")]
    for run in _CJK_RUN_RE.findall(text or ""):
        for i, ch in enumerate(run):
            out.append(ch)
            if i + 1 < len(run):
                out.append(run[i : i + 2])
    return out


def tokenize_query(text: str) -> List[str]:
    """查询侧分词：**丢掉单字汉字**，只留二字词及以上。

    索引侧留单字、查询侧丢，是刻意的不对称。TS 那边记着实测数字：查询
    「zzzz不存在」在留单字时能命中 84 条，因为「不」「存」「在」几乎每条说明
    里都有——这不是排序问题，是这些字压根不该参与检索。

    兜底：滤完一个不剩（用户就打了一个字）时退回原分词，否则变成永远搜不到。
    """
    all_tokens = tokenize(text)
    kept = [t for t in all_tokens if not _SINGLE_CJK_RE.match(t)]
    return kept or all_tokens


def intent_terms(query: str) -> str:
    """意图词表命中的能力词（不含原话）。"""
    return " ".join(terms for pat, terms in _LEXICON["rules"] if pat.search(query or ""))


def expand_intent(query: str) -> str:
    """把一句自然语言展开成「原话 + 能力词」。"""
    extra = intent_terms(query)
    return f"{query} {extra}" if extra else (query or "")


def _doc_fields(block: Dict[str, Any]) -> Dict[str, str]:
    """一个区块的可检索字段。权重见 block_intent_lexicon.json 的 fieldWeights。"""
    binding = block.get("bindingSchema") or {}
    parts = " ".join(
        str(x)
        for x in list((binding.get("entityFieldRefs") or {}).keys())
        + list(block.get("allowedRegions") or [])
    )
    return {
        "name": str(block.get("type") or ""),
        "label": str(block.get("label") or ""),
        "parts": parts,
        "tags": " ".join(
            str(x) for x in [block.get("family"), block.get("group"), block.get("generality")] if x
        ),
        "description": str(block.get("description") or ""),
    }


def _weighted_tokens(block: Dict[str, Any], weights: Dict[str, int]) -> List[str]:
    """按字段权重把 token 重复若干次——rank_bm25 没有字段加权，用重复等价实现。

    这是 BM25 里做字段加权的标准土办法（词频翻倍等于该字段权重翻倍）。选它而不
    是自己改打分函数，是为了让 rank_bm25 保持是那个被测过的实现。
    """
    toks: List[str] = []
    for field, text in _doc_fields(block).items():
        w = int(weights.get(field, 1))
        if w <= 0:
            continue
        toks += tokenize(text) * w
    return toks


def narrowing_enabled() -> bool:
    """目录窄化开关。**默认开**（2026-08-11 翻的），显式置 0/false/no/off 可关。

    ## 翻默认的依据

    docs/block-narrowing-eval.md：两个覆盖域各臂 n=6（共 24 趟）新跑对照——

        对题件被选中(均)   关 0.67 [0,2]  →  开 3.25 [1,7]
                           Mann-Whitney 单尾精确 p=0.00004
        首轮过闸           关 10/12 (83%) →  开 12/12 (100%)
                           Fisher 双尾 p≈0.48 —— **无差异**
        prompt 字符        160,528        →  53,298（−67%）

    也就是说：**它的价值在选材相关性，不在过闸率**。过闸率的提升来自那几条确定性
    修复（workflowRef / 区块槽位越界 / layout 面板 ref 撞车），对两臂一视同仁，
    早期"窄化把过闸抬上去了"那个归因是错的，别再沿用。

    零覆盖域的净负面（B1 阴性对照实测 −58%）由自适应判定兜住——置信度低于阈值
    就退回全量，系统提示与全量**逐字相同**（见 retrieval_confidence 与
    test_零覆盖域的系统指令与全量逐字相同）。所以翻默认不会把那笔代价带上线。

    ## 仍然开着的两个口子（翻默认时明确接受的风险）

      · release_deployment 的对照臂当时被上游网关 12/12 拒（HTTP 400），该域只有
        处理臂数据，缺一组完整对照；
      · 三个覆盖域都集中在目录建得厚的地方（Alert/Booking/Release），真实用户题目
        的域分布未知。零覆盖域是靠兜底挡住，不是靠窄化本身变好。

    要临时关掉（排查、或对照复跑）：`SLIDERULE_BLOCK_CATALOG_NARROWING=0`。
    """
    raw = str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING", "")).strip().lower()
    if raw in _env_flags.OFF:
        return False
    return True


def narrowing_limit(default: int = 60) -> int:
    raw = str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING_LIMIT", "")).strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return default


#: 检索置信度阈值：低于它就不窄化，原样注全量目录。
#
# 2026-08-10 阴性对照实测出来的必要性：目录**零覆盖**的域（医院药房库存）上，
# 窄化反而更差——特定场景件被选中从 6.33 掉到 2.67（-58%）、去重类型 11 → 8、
# 用到的最远原名次 242 → 23。原因是检索捞不到对题件，筛出的 60 个大多是不相关
# 的浅层通用件；而全量时模型至少有机会自己在深处摸到勉强能用的件。
#
# 所以窄化必须**自适应**：先问"目录里到底有没有对题的东西"，没有就别筛。
_CONFIDENCE_THRESHOLD = 0.20


def narrowing_confidence_threshold() -> float:
    raw = str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING_MIN_CONFIDENCE", "")).strip()
    try:
        v = float(raw)
        return v if v >= 0 else _CONFIDENCE_THRESHOLD
    except ValueError:
        return _CONFIDENCE_THRESHOLD


#: 算置信度时看多深。固定 20 而不是跟着 limit 变——阈值是在 top-20 上标定的，
#  跟着 limit 变会让阈值失去意义。
_CONFIDENCE_DEPTH = 20


def retrieval_confidence(scores: Sequence[float], query_token_count: int) -> float:
    """「目录里到底有没有对题的东西」的一个标量。

    = top-20 平均 BM25 得分 ÷ 查询词数

    ## 为什么是这个式子，而不是业界常用的那些

    实测四个用例（三个目录覆盖的域 + 一个零覆盖域）之后定的：

                          top1    top20均   每词归一
        release           48.40    30.57     0.437
        alert             42.24    26.22     0.364
        booking           34.77    20.39     0.291
        pharmacy(零覆盖)   9.48     5.26     **0.110**

    · **相对/形状类信号在这里全部失效**。`top1/全体均` 上 pharmacy 是 23.5，
      **最高**；`top10 占比` 上 pharmacy 是 44.6%，也最高——因为它整体都低，
      比值反而好看。所以"归一化成相对分再比"这条常规建议在这个问题上是错的。
    · Weaviate 的 autocut / kneed 那套膝点检测也答不了这个问题：它回答的是
      "该在第几个截断"，**前提是假定有相关结果**；我们要判的恰恰是"有没有"。
      pharmacy 的分数曲线同样有膝点。
    · 能分开的是**绝对分数水平**。这在本场景成立是因为语料固定（358 个区块），
      所以跨查询的 BM25 绝对值可比。
    · 再除以查询词数是因为 BM25 是各查询词得分之和，会随题目长度线性涨。实测
      长度抽查：同一道告警题写成 5 词 → 1.149、103 词 → 0.421（原版 0.364）；
      药房写成 7 词 → 0.000、83 词 → 0.145。**短查询是往上跑**，所以阈值对
      短题只会更安全。

    阈值 0.20 取的是 0.291（该窄化里最低）与 0.145（不该窄化里最高）的几何中点。
    ⚠️ 只在 4 个用例 + 4 条长度抽查上标定过。加新用例时应当重新看这组数
      （scripts/block_selection_metrics.py 会打印每个用例的置信度）。
    """
    if not len(scores) or query_token_count <= 0:
        return 0.0
    top = sorted(scores, reverse=True)[:_CONFIDENCE_DEPTH]
    return (sum(top) / len(top)) / query_token_count


#: 自适应 limit 的相对分数阈值：保留得分 ≥ α × 最高分 的候选。
#
# arXiv 2605.24660 的结论是"最优深度随题目难度变"，固定 60 不会是最优。这里用
# **相对分数截断**来实现——这正是 Weaviate autocut / kneed 那套膝点检测擅长的
# 问题（"取多少个"）。注意跟 retrieval_confidence 那个判断的区别：那边问的是
# "到底有没有相关的"，相对信号在那儿**失效**（见其头注）；这边问的是"相关的取
# 到哪为止"，相对信号才是对的工具。
#
# α=0.20 是量出来的。三个覆盖域上按 α 扫召回：
#
#              固定 N=60      α=0.25            α=0.20
#     alert     14/16        N=31 召回 13/16   N=37 召回 **14/16**
#     booking   15/15        N=45 召回 15/15   N=58 召回 **15/15**
#     release   17/17        N=40 召回 17/17   N=50 召回 **17/17**
#
# 0.20 是**保住与固定 60 完全相同召回**的最激进取值；再紧一档（0.25）alert 就掉
# 一个对题件。论文明确记过固定砍到 5 条时"难题上一条都没找着"，所以宁可留余量。
_SCORE_CUTOFF_RATIO = 0.20

#: 自适应的下限。低于它就不再收窄——这里一次要为 5~7 个页面选材，候选太少会重现
#  论文里"难题上一个都找不着"那种失败。实测三个域最紧也要 31 个才接近满召回。
_ADAPTIVE_FLOOR = 30


def adaptive_limit(scores: Sequence[float], hard_limit: int, mandatory_count: int = 0) -> int:
    """按分数曲线决定这次实际注入多少个（**只会比 hard_limit 更小，不会更大**）。

    只收窄不放宽是刻意的：hard_limit 是产品配置的上界，自适应无权突破它——
    突破会让 prompt 体积不可预期，而"目录里压根没有对题件"那种情况已经由
    retrieval_confidence 退回全量处理掉了，不需要靠放宽 limit 兜。
    """
    vals = sorted((float(x) for x in scores), reverse=True)
    if not vals or vals[0] <= 0:
        return hard_limit
    ratio = _SCORE_CUTOFF_RATIO
    raw = str(os.getenv("SLIDERULE_BLOCK_CATALOG_NARROWING_CUTOFF", "")).strip()
    try:
        v = float(raw)
        if 0 < v <= 1:
            ratio = v
    except ValueError:
        pass
    keep = sum(1 for x in vals if x >= ratio * vals[0])
    return max(_ADAPTIVE_FLOOR, min(hard_limit, keep + mandatory_count))


def select_blocks(
    blocks: Sequence[Dict[str, Any]],
    goal: str,
    *,
    limit: int = 60,
    mandatory: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    """按题意挑出 ≤limit 个区块，**保底集合永远在最前**。

    返回顺序即注入顺序：保底件在前（预设要用它们），其后按 BM25 得分降序——
    得分高的越靠前，正是可达性最好的位置。

    goal 为空、rank_bm25 缺失、或 limit 大于全量时，**原样返回全量**（fail-open
    ——窄化是优化，不该让生成不可用）。
    """
    all_blocks = list(blocks)
    if not (goal or "").strip() or limit >= len(all_blocks):
        return all_blocks

    keep_names = list(mandatory or [])
    by_name = {str(b.get("type")): b for b in all_blocks}
    head = [by_name[n] for n in keep_names if n in by_name]
    head_names = {str(b.get("type")) for b in head}
    rest = [b for b in all_blocks if str(b.get("type")) not in head_names]

    room = limit - len(head)
    if room <= 0:
        return head

    try:
        from rank_bm25 import BM25Okapi
    except Exception as exc:  # noqa: BLE001 — 依赖缺失不该让生成挂掉
        # fail-open 是对的（少一个依赖不该让整条生成挂掉），但**静默** fail-open
        # 不对：这条路上退回全量 = 窄化整个功能没生效，而窄化不是可有可无的增强，
        # 是那 306 个够不到的区块唯一的出路（对题件被选中 0.67 → 3.25，
        # p=0.00004）。没有这行日志，线上少装一个包的后果就是"效果没了，
        # 而且看不出来"。
        #
        # 2026-08-11 实测踩到：rank_bm25 当时压根不在 requirements.txt 里，
        # 而 Dockerfile 只装那一个文件——按当时的状态部署上去，窄化会一声不吭
        # 地整个关掉。这类"验证手段/降级路径本身骗人"本场已经是第 7 次。
        _warn_once(
            f"[block_narrowing] rank_bm25 缺失（{type(exc).__name__}），"
            "本次注入退回全量目录——窄化未生效。检查 requirements.txt 是否装齐。"
        )
        return all_blocks

    weights = _LEXICON["fieldWeights"]
    corpus = [_weighted_tokens(b, weights) for b in rest]
    if not any(corpus):
        return all_blocks
    bm25 = BM25Okapi(corpus)
    query = tokenize_query(expand_intent(goal))
    scores = bm25.get_scores(query)

    # ── 自适应：目录里压根没有对题件时，不窄化 ──────────────────────────────
    #
    # 见 retrieval_confidence 头注。零覆盖域上窄化是净负面（实测 -58%），所以
    # 这里 fail-open 回全量：窄化是优化，不该在它帮不上忙的题目上反而伤人。
    confidence = retrieval_confidence(scores, len(query))
    threshold = narrowing_confidence_threshold()
    if confidence < threshold:
        print(
            f"[block_narrowing] 检索置信度 {confidence:.3f} < {threshold:.3f}"
            f"（目录里没有对题区块）——本次不窄化，注入全量 {len(all_blocks)} 个",
            flush=True,
        )
        return all_blocks

    ranked = sorted(
        range(len(rest)),
        key=lambda i: (-float(scores[i]), all_blocks.index(rest[i])),
    )
    # 自适应：分数曲线陡降之后的那些拿进来只是噪声。实测在三个覆盖域上都能保住
    # 与固定 60 相同的召回，同时把候选降到 37~58（见 adaptive_limit 头注）。
    effective = adaptive_limit(scores, limit, mandatory_count=len(head))
    room = max(0, effective - len(head))
    return head + [rest[i] for i in ranked[:room]]


def preset_block_names(page_kind_presets: Dict[str, Any]) -> List[str]:
    """PROVEN LAYOUTS 里点名的区块——窄化的保底集合。

    从预设本身派生，不手写清单：预设改了保底集合自动跟上。漏掉任何一个都会让
    prompt 自相矛盾（预设叫模型用它、目录里却没有）。
    """
    names: List[str] = []
    for presets in (page_kind_presets or {}).values():
        for ps in presets or []:
            for item in (ps or {}).get("blocks") or []:
                t = str((item or {}).get("type") or "").strip()
                if t and t not in names:
                    names.append(t)
    return names


def derive_goal_presets(
    picked: Sequence[Dict[str, Any]],
    page_kind_presets: Dict[str, Any],
    page_kinds: Sequence[str],
    *,
    max_blocks: int = 3,
) -> Dict[str, List[Dict[str, Any]]]:
    """按题意为每种页面形态派生一套预设（**只加不减**，authored 那 10 档照旧在前）。

    ## 为什么需要它：窄化只解决了第 1 层

    2026-08-10 实测：窄化把对题件送进可达区（0/16 → 14/16），选中数也涨了
    （0.5 → 4.5），但**仍然只有 4.5/16**。残余的原因是 PROVEN LAYOUTS 那 10 档
    预设点名的全是通用件，而 prompt 明写"从这些起手"。

    最直接的证据：`AlertSilenceForm` 的 allowedRegions 是 `overlay,supplement`
    ——它是个弹窗式表单，跟 authored 预设里 workbench 那档的 `RecordFormDialog@overlay`
    **抢同一个位置**，而预设点名的是后者。于是静默页三趟都用 RecordFormDialog。
    把对题件也摆成一档预设，才是让它进入"挑选"而不是"自己发明"的唯一办法。

    ## 保住那句"已经预先校验过"

    authored 预设是手写的，启动时按三条硬校验（见 _load_page_kind_presets）：
    区块通电、`kind ∈ block.pageKinds`、`region ∈ block.allowedRegions`。派生的
    这批**按构造**满足同样三条——候选只从通电区块里取，页型和区域都从区块自己
    声明的集合里选。所以 prompt 里那句承诺对新增的几档同样成立。

    不满足的一律不生成（而不是硬报错）：派生是增强项，失败就退回只有 authored
    那 10 档，绝不能让生成挂掉。

    ## 组法

    候选 = 窄化结果里**去掉保底件**之后的那截（保底件就是 authored 预设点名的
    那 10 个，再推荐一遍没有意义），顺序即相关性顺序。每种页型取前 ≤3 个，且
    **各占不同区域**——都塞 main 会挤成一坨，也无法体现"排好的版面"。
    少于 2 个就不出这一档：单件预设提供的信息不值一行 prompt。
    """
    used_names = set(preset_block_names(page_kind_presets))
    tail = [b for b in picked if str(b.get("type")) not in used_names]
    out: Dict[str, List[Dict[str, Any]]] = {}

    for kind in page_kinds:
        items: List[Dict[str, Any]] = []
        taken_regions: set = set()
        for b in tail:
            if len(items) >= max_blocks:
                break
            if not b.get("generationEnabled"):
                continue
            if kind not in (b.get("pageKinds") or []):
                continue
            region = next(
                (r for r in (b.get("allowedRegions") or []) if r not in taken_regions),
                None,
            )
            if region is None:
                continue
            taken_regions.add(region)
            items.append({"type": str(b["type"]), "region": region, "_label": str(b.get("label") or "")})
        if len(items) < 2:
            continue
        labels = " + ".join(it["_label"] or it["type"] for it in items)
        out[kind] = [
            {
                "id": f"goal_fit_{kind}",
                "name": f"按题意 · {labels}",
                "when": (
                    "这一页的职责正好落在这几个专用件上时——它们是按本次业务目标从目录里"
                    "检索出来的，比通用表格/表单更贴题；业务确实更需要上面那几档通用组合时照旧用它们。"
                ),
                "blocks": [{"type": it["type"], "region": it["region"]} for it in items],
            }
        ]
    return out
