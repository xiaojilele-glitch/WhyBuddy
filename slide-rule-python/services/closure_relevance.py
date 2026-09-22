# -*- coding: utf-8 -*-
"""闭环相关性校验：产出的模型到底是不是**这道题**的产出。

## 为什么需要这个

闭环判定原先只数「6 个技能证据齐不齐」，不看证据的内容。于是 2026-08-04 这轮
出现了：用户要「中小学课后托管」，上游 LLM 网关偶发 400 → agentic-pick 回落
规则版 → 没跑建模链路 → 舞台回退渲染内置的「员工请假管理」样板 → 6 项证据
数量齐全 → 判 `closed 6/6` 交付。模型自己在收口总结里写了「尚未证实已实现
学生、班次、排班、签到签退和托管账单」，但那句话不参与任何判定。

## 做法来源

骨架照 RAGAS 的 `NonLLMContextRecall`（src/ragas/metrics/_context_recall.py）：
对 reference 里的每一项，在 retrieved 里取**最大**相似度，再平均成覆盖率，
拿阈值卡。这里的对应关系是：

    reference_contexts  →  目标拆出来的业务点（"登记学生和托管班次"…）
    retrieved_contexts  →  模型里的实体名 + 页面名（"就餐老人"、"每日菜单"…）

输出契约照 DeepEval 的 `AnswerRelevancyMetric`
（deepeval/metrics/answer_relevancy/answer_relevancy.py）：`score` /
`threshold` / `passed` / `reason` 四件套——判定要能自解释，光给个 bool
排查不了。

**必须是 non-LLM 的**：这条校验的主要触发场景就是「LLM 挂了导致降级」，
再调一次 LLM 判相关性等于循环依赖，故障时必然一起失效。所以全程纯字符串
计算，零依赖（环境里没有 jieba / rapidfuzz，也不为这个引）。

## 相似度为什么用非对称包含度而不是 Dice

中文没有空格分词，用字符 bigram。但实体名（"就餐老人"，3 个 bigram）通常比
目标短语（"登记就餐老人"，5 个 bigram）短，对称的 Dice 会被长度差稀释。
改成「短的那个有多少比例被长的覆盖」——`|A∩B| / min(|A|,|B|)`。

## 参数是标定出来的，不是拍的

标定集：App Store 里 6 个真实落库应用（邻里食安/暖食通×2/心桥咨询/安消巡管/
绘本借阅）当正例，它们两两错配出 24 个负例对，外加 2026-08-04 跑歪那次的
真实数据（课后托管的目标 × 内置请假样板）。实测：

    公式          单项阈值   正例覆盖率最低   错配对最高   真实负例
    Dice          0.5        0.50            —           0.00
    包含度        0.3        0.80            —           0.14
    包含度        0.5        0.71            0.00        0.14   ← 选它

选包含度 + 单项 0.5：正例最低 0.71，24 个错配对**全部 0.00**，真实负例 0.14。
覆盖率阈值取 0.5，落在 0.14 与 0.71 之间，两边各留 0.36 / 0.21 的余量。
Dice 虽然负例更干净，但正例最低只有 0.50，贴着阈值没余量，弃用。

标定脚本与数据见提交说明；重标定时把阈值连同上表一起改，别只改数字。

## ⚠ 2026-09-05 重标定：上面那套在真库上误杀了三分之一

原标定集是**手写的** 3 个应用 + 交叉错配。拿真库里 152 个真会话
（自己的题 × 自己的模型 = 正例；交叉错配 = 负例，题目近似的对子剔除）重跑，
现状这套的成绩是：

    正例过闸 36.6%（全集）/ 40.0%（有 SPEC 的会话）   负例拦下 99.97%

**十个做对了的应用，六个被判成「产出与题目不符」。** 手写标定集看不出来，
因为它的正例是照着"目标里的词"写的名字（"就餐老人"对"登记就餐老人"），
而真机上模型用的是行业自然叫法：

    题「经典单机大鱼吃小鱼闯关游戏」  模型「海域关卡」「海洋生物图鉴」  → 0.000
    题「流浪猫智能救助（匹配识别）」  模型「救助档案」「AI匹配」        → 0.000

三处改动，逐一在真库上量过（下表）：

  ① 词表加上 SPEC 节点标题。判定侧原先只看六系统的**显示名**，而 SPEC 才是
     "这个应用要干什么"的记录——`_relevance_findings` 的入参里压根没有它。
     spec-first 是后加的一条链，判定侧没跟上（§4 只改一半）。
     抄 grok-build `goal_classifier/evidence.rs`：怀疑者拿到的证据包里
     除了 CHANGED_FILES 还有 **PLAN_FILE / PLAN_CHANGES**——判"做到没有"
     必须看得见"打算做什么"。
  ② 业务点的命中判定加一路 pool（字眼散落在整个词表里也算），与原来的
     max 取并集 —— 不再只问"有没有哪一个名字长得像它"。
     4 字业务点只有 3 个 bigram，跟任一单名共享 1 个就是 0.33，卡死在门槛下：
     「老人全景档案 vs 长者档案」「送达签收 vs 超距签收拦截」「餐次预订 vs
     服务预订待排班」全是 0.33 → 全判没做。合集问的是"这个点的字眼在这个应用里
     出现过吗"，这才是"做了没有"该问的。
  ③ 括号里的内容是上一个点的**细化**，不各算一个业务点。
     「老人全景档案（基础信息、慢病标签、饮食忌口、照护等级与补贴资质）」
     现状拆成 6 个点，分母凭空 +5。

真库标定（正例 110 / 负例 16522；有 SPEC 的子集 正例 15 / 负例 210）。

起点 —— 现状 `max@0.50`、不看 SPEC、不去括号：

    正例过闸 40.0%（有 SPEC）/ 36.6%（全集）   负例拦下 99.52% / 99.97%

固定 ①SPEC + ③去括号之后，把打分方式和阈值**分开扫**（第一版没分开扫，
把阈值的功劳算在了打分方式头上，这里改正）。三种打分方式：

    max     业务点跟**某一个**名字的最大相似度（原来那套）
    pool    业务点的字眼在**整个词表**里出现了多少
    hybrid  两者取并集——像某个名字，**或者**字眼散落在词表里

    打分方式  阈值   正例过闸(有SPEC/全集)   负例拦下(有SPEC/全集)
    max      0.30    86.7% / 88.2%         99.05% / 96.65%
    pool     0.30    86.7% / 70.0%        100.00% / 99.48%
    hybrid   0.30    93.3% / 90.9%         99.05% / 96.21%
    hybrid   0.35    93.3% / 85.5%         99.52% / 98.77%   ← 选它
    hybrid   0.40    93.3% / 83.6%         99.52% / 99.03%

选 **hybrid@0.35**：召回上 hybrid 处处不低于另外两个（93.3%/85.5%），
拦截上跟**改动前的现状逐位持平**（有 SPEC 99.52%，跟老的 max@0.50 一样）。
也就是说这次是**净赚**：误杀从 60% 掉到 6.7%，漏放一点没多。

⚠ 第一版选的是纯 pool@0.30，被真机夹具打回来了，教训留着：

    「我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效」
      pool = 0.250（判不相关）   max = 0.750   hybrid = 0.750

  业务点里带口语填充词时，"我们"、"们客"、"团队"、"队需" 这些 bigram 在
  任何应用词表里都不会出现，pool 把整条长句结构性压低。标定集上看不出来
  （真会话的目标多是书面语），是 `test_model_section_priority` 变红才照出来的
  ——**标定集再大也只是标定集，仓里既有的判据是另一组真数据**。

阈值不取 0.30（有 SPEC 的拦截率掉到 99.05%，比现状差），不取 0.40
（召回少 2 个点换 0.26 个点的拦截率，不划算）。

锚点在新操作点下逐条复核过：

    2026-08-04 真实事故（托管 × 请假样板）   0.000  → 拦下（比原来的 0.143 更干净）
    手写标定集 3 个正例                     0.571 / 0.667 / 0.714  → 放行
    手写标定集 6 个错配对                    最高 0.000  → 拦下

余量：手写正例最低 0.571 − 阈值 0.30 = +0.271；阈值 − 错配最高 = −0.30。

## ⚠ 这把尺子有**两个**用户，操作点不共用

`app_template.match_app_template` 拿同一个 `goal_coverage` 挑骨架模板，
方向是**反的**：闭环判定判不了要放行（别误杀已经生成好的模型），套模板判不了
要拒绝（"判不了却套上，等于把别人的应用扣在用户头上"，见那个模块头）。

所以阈值和算法都做成**参数**，不是全局常量一改两处跟着变：

    CLOSURE_COVERAGE_THRESHOLD = 0.35   闭环判定，2026-09-05 真库标定
    COVERAGE_THRESHOLD         = 0.5    套模板沿用，**没有**重标定过

套模板那一路我手上没有标定集（要拿模板种子 × 真实目标另建一套），所以
**不动它**——原样保留 max + 0.5。别看见两个阈值就"统一"掉：统一等于把一个
没标定过的操作点塞给另一个用户。
"""

from __future__ import annotations
from .archetype_legal import required_evidence as _required_evidence

import re
from typing import Any, Dict, List, Sequence

# ── 标定出来的参数（改动请重跑标定，见模块头） ──
TERM_HIT_THRESHOLD = 0.5
"""单个业务点算「被覆盖」的相似度门槛。"""

COVERAGE_THRESHOLD = 0.5
"""**套模板**那一路的覆盖率阈值（`app_template.match_app_template`）。

同 RAGAS NonLLMContextRecall 默认。2026-09-05 重标定**没有**动它——那一路
的代价函数跟闭环判定相反，而我手上没有它的标定集。见模块头最后一节。
"""

CLOSURE_COVERAGE_THRESHOLD = 0.35
"""**闭环判定**那一路的覆盖率阈值。2026-09-05 拿真库 152 个会话标定，见模块头。

⚠ 跟 `COVERAGE_THRESHOLD` 是两个数，不许"统一"——统一等于把一个没标定过的
操作点塞给另一个用户。
"""

MIN_PHRASES = 3
"""目标拆不出 3 个业务点就不判——太短的目标样本量不足，误杀风险高于收益。"""

# 句子切分：中英文标点通吃
_SPLIT_RE = re.compile(r"[，,。：:；;、\n\r\t（）()【】\[\]]+")
# 并列连词：一个分句里常挂多个业务点（"登记学生和托管班次"）
_CONJ_RE = re.compile(r"[和与及跟]")
# 只掐纯功能性套话，绝不碰业务词；"做一套/做一个" 可能出现在句中而非句首
_NOISE_RE = re.compile(r"(^(给|建|开发|搭建)|做一[套个]|^做|一[套个]|系统$|平台$)")
_TIGHTEN_RE = re.compile(r"[\s\-_/]+")
#: 括号里的内容是**上一个业务点的细化**，不是新的业务点（2026-09-05 重标定 ③）。
#: 「老人全景档案（基础信息、慢病标签、饮食忌口、照护等级与补贴资质）」原先
#: 拆成 6 个点，分母凭空 +5——范围卡把目标扩写成带括号的长文本之后，这种形状
#: 是常态。真库上去掉它：有 SPEC 的会话正例过闸 80.0% → 86.7%，负例拦下不变。
#: ⚠ 只掐**括号**这一种。另一半"通用词"（基础信息/调度调整/质量监督/中心质控）
#:   没做成停用词表：那种表是领域相关的，抄 grok query_expansion.rs 那份英文
#:   虚词表在中文业务词上不成立，掐错一个就是把真业务点掐没了。括号这一刀
#:   有结构依据（它就在括号里），停用词那一刀只有语感——语感不进标定过的模块。
_PAREN_RE = re.compile(r"[（(][^）)]*[）)]")


def split_goal_phrases(goal: str, *, drop_paren_details: bool = False) -> List[str]:
    """把目标拆成业务点列表——对应 RAGAS 的 reference_contexts。

    刻意**不做分词**：分词要么引依赖，要么在业务复合词上出错（"刷卡就餐记录"
    会被切碎）。按标点+并列连词切到短语粒度就够了，而且短语粒度恰好就是我们
    想校验的东西——「这个业务点做了没有」。

    `drop_paren_details`：括号里的内容当成上一个点的细化，不各算一个业务点
    （2026-09-05 重标定 ③）。**默认关**——它跟 pool 模式、0.30 阈值是同一个
    标定过的操作点上的三件事，只有闭环判定那一路开。套模板那一路不开：
    去掉括号会抬高覆盖率，而那一路抬高覆盖率的方向是"更容易把别人的应用扣上"
    （见模块头最后一节），我手上没有它的标定集，不动。
    """
    text = _PAREN_RE.sub("", goal or "") if drop_paren_details else (goal or "")
    out: List[str] = []
    for seg in _SPLIT_RE.split(text):
        for part in _CONJ_RE.split(seg.strip()):
            part = _NOISE_RE.sub("", part.strip()).strip()
            if len(part) >= 2:
                out.append(part)
    return out


def _bigrams(text: str) -> set:
    tight = _TIGHTEN_RE.sub("", (text or "").lower())
    if len(tight) < 2:
        return {tight} if tight else set()
    return {tight[i:i + 2] for i in range(len(tight) - 1)}


def containment(a: str, b: str) -> float:
    """非对称包含度：短的那个有多少比例被长的覆盖。见模块头「为什么不用 Dice」。"""
    ba, bb = _bigrams(a), _bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / min(len(ba), len(bb))


_MODEL_TERM_KEYS = frozenset({"name", "label", "title", "description"})


def _collect_named_terms(value: Any, terms: List[str]) -> None:
    """Collect only schema-owned display fields, never arbitrary generated prose."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key in _MODEL_TERM_KEYS and isinstance(child, str) and child.strip():
                terms.append(child.strip())
            elif isinstance(child, (dict, list)):
                _collect_named_terms(child, terms)
    elif isinstance(value, list):
        for child in value:
            _collect_named_terms(child, terms)


def collect_model_terms(model: Any) -> List[str]:
    """Extract evidence terms from all final six-system ``modelSection`` values.

    IDs and free-form content remain excluded. In addition to controlled display
    fields, a few structural capabilities are derived from the schema itself:
    RBAC proves role/permission support and a dashboard page proves a data board.
    """
    if not isinstance(model, dict):
        return []

    terms: List[str] = []
    # ⚠ 2026-08-30：第 13 处手抄，顺序同样与主表不同。本模块是**标定过的**
    #   （模块头有标定集与阈值对照），所以改之前实测了顺序敏感性：
    #   `goal_coverage` 取的是最大相似度、`collect_model_terms` 结尾去重，
    #   200 次随机打乱 score 与 passed 完全一致 → 顺序无关，可以同源。
    #   **别跳过这一步**：第六条说标定过的参数不许拍脑袋改。
    for section in _required_evidence():
        _collect_named_terms(model.get(section), terms)

    rbac = model.get("rbac")
    if isinstance(rbac, dict) and (rbac.get("roles") or rbac.get("menus") or rbac.get("permissions")):
        terms.extend(["角色", "权限", "角色权限"])

    page = model.get("page")
    pages = page.get("pages") if isinstance(page, dict) else None
    for pg in pages or []:
        if not isinstance(pg, dict):
            continue
        if str(pg.get("kind") or "").strip() in ("dashboard", "monitor"):
            terms.extend(["数据看板", "运营总览"])

    identity = ((model.get("appbundle") or {}).get("appIdentity") or {})
    if isinstance(identity, dict) and str(identity.get("productName") or "").strip():
        terms.append(str(identity["productName"]).strip())

    return list(dict.fromkeys(terms))


def goal_coverage(
    goal: str,
    terms: Sequence[str],
    *,
    mode: str = "max",
    threshold: float = COVERAGE_THRESHOLD,
) -> Dict[str, Any]:
    """覆盖率判定。返回 DeepEval 风格的自解释结果。

    `applicable=False` 表示样本不足以判定（目标太短或模型没有可比对的名字），
    调用方应当**放行**——这条校验只负责抓「明确不相关」，不负责在信息不足时
    替别人下结论。
    """
    # mode / threshold / 去括号 是**同一个标定过的操作点上的三件事**，一起动
    # 一起不动（见模块头）。pool = 2026-09-05 闭环判定操作点；max = 套模板沿用。
    phrases = split_goal_phrases(goal, drop_paren_details=(mode == "hybrid"))
    usable = [t for t in terms if str(t).strip()]

    if len(phrases) < MIN_PHRASES or not usable:
        return {
            "applicable": False,
            "score": 1.0,
            "threshold": threshold,
            "passed": True,
            "matched": [],
            "missing": [],
            "reason": (
                f"样本不足以判定相关性（业务点 {len(phrases)} 个 < {MIN_PHRASES}"
                f"，模型可比对名称 {len(usable)} 个），跳过。"
            ),
        }

    matched: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    pool: set = set()
    if mode == "hybrid":
        for term in usable:
            pool |= _bigrams(term)
    for phrase in phrases:
        best_score, best_term = 0.0, ""
        for term in usable:
            s = containment(phrase, term)
            if s > best_score:
                best_score, best_term = s, term
        if mode == "hybrid":
            # 两个信号取**并集**：有某个名字长得像它（上面的 max），
            # 或者它的字眼散落在整个词表里（下面的 pool）。
            #
            # 只用 max 会漏：4 字业务点跟任一单名共享 1 个 bigram 就是 0.33，
            # 而「老人全景档案 vs 长者档案」「餐次预订 vs 服务预订待排班」
            # 正是同一件事的两种叫法。
            # 只用 pool 会漏另一头：业务点里带口语填充词时，那些 bigram
            # （"我们"、"们客"、"团队"、"队需"）在任何应用词表里都不会出现，
            # 长句被结构性压低——真机夹具「我们客服团队需要一个服务工单系统…」
            # pool 只有 0.250，max 有 0.750。第一版选了纯 pool，就是被这条
            # 打回来的（test_model_section_priority 变红）。
            bp = _bigrams(phrase)
            if bp:
                best_score = max(best_score, len(bp & pool) / len(bp))
        item = {"phrase": phrase, "score": round(best_score, 3), "matchedBy": best_term}
        (matched if best_score >= TERM_HIT_THRESHOLD else missing).append(item)

    score = len(matched) / len(phrases)
    passed = score >= threshold
    if passed:
        reason = f"目标的 {len(phrases)} 个业务点覆盖了 {len(matched)} 个（{score:.0%}）。"
    else:
        gaps = "、".join(m["phrase"] for m in missing[:5])
        reason = (
            f"产出与题目不符：目标的 {len(phrases)} 个业务点只覆盖了 {len(matched)} 个"
            f"（{score:.0%} < {threshold:.0%}）。未见落实：{gaps}。"
        )
    return {
        "applicable": True,
        "score": round(score, 3),
        "threshold": threshold,
        "passed": passed,
        "matched": matched,
        "missing": missing,
        "reason": reason,
    }


def collect_spec_terms(spec: Any) -> List[str]:
    """SPEC 树里的需求标题——「这个应用**打算**干什么」的记录。

    2026-09-05：判定侧原先只看六系统的显示名，而显示名是被压短的（菜单标签
    2~4 字、页名更短，手机 IA 提示词还明文要求"不要带页"）。真正写着
    「助餐网格配送与现场LBS签收闭环」的是 SPEC 节点标题——判定侧却看不见它，
    因为 `_relevance_findings` 的入参里压根没有 SPEC。

    抄 grok-build `goal_classifier/evidence.rs`：怀疑者的证据包里
    CHANGED_FILES 之外还有 **PLAN_FILE / PLAN_CHANGES**——判"做到没有"必须
    看得见"打算做什么"。

    ⚠ 只取 `title`，**不取 `acceptance`**：后者是整句散文（"当照护员与配送员
      登录系统时…"），跟任何题目都共享一堆 bigram，进词表等于把闸泡软。
      同 `_collect_named_terms` 那条纪律：只收 schema 自己的展示字段，
      不收自由生成的散文。
    """
    if not isinstance(spec, dict):
        return []
    out: List[str] = []
    for node in spec.get("nodes") or []:
        if isinstance(node, dict):
            title = str(node.get("title") or "").strip()
            if title:
                out.append(title)
    return list(dict.fromkeys(out))


def evaluate_model_relevance(
    goal: str, model: Any, *, spec: Any = None
) -> Dict[str, Any]:
    """对外入口：目标 vs 五系统模型的相关性。

    `spec` 在场时它的需求标题一并进词表（见 collect_spec_terms）。
    操作点用 `CLOSURE_COVERAGE_THRESHOLD` + pool，2026-09-05 真库标定，
    **不是** `COVERAGE_THRESHOLD`（那是套模板那一路的，没重标定过）。
    """
    return goal_coverage(
        goal,
        collect_model_terms(model) + collect_spec_terms(spec),
        mode="hybrid",
        threshold=CLOSURE_COVERAGE_THRESHOLD,
    )
