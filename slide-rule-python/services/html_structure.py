"""第 4 步：HTML → 实体 / 字段 / 关联 / 页面结构。

## 这一步在链路里的位置

    1 澄清+缺口+证据      ✅ 现成能力
    2 起草 SPEC           ✅ services/spec_tree.py
    3 spec 每一页 → HTML  ✅ services/spec_page_html.py
    4 **本文件**：HTML → 实体/字段/关联/页面结构
    5 (第4步产物 + SPEC) → 权限/工作流/不变式
    6 汇合 → 五系统模型 → 结构闸 → 设计

它**只产结构，不产语义**。权限、工作流、不变式一律不碰——那三样从画面里推不
出来，是实测钉死的（4 份 HTML 里「角色/权限/主管/管理员」出现 0 次、
「成交/流失/归档/阶段」0 次，五组推出来的流程拓扑完全相同 5 节点 6 转移，
那是模型的行业常识不是证据）。它们归第 5 步，输入是本步产物 + SPEC 两样。

## 抄了两处开源，各解一个具体问题

### ① 先选表示再喂 —— 借自 llm-scraper（mishushakov/llm-scraper）

它的思路是喂给 LLM 之前先把网页转成某种表示（html / markdown / text / image）。
⚠ 但它的 `text` 模式用 Readability.js，那个**对这件事是反的**——Readability
专门剥掉导航和侧栏，而我们要的恰恰是菜单、表格、表单这些结构。所以借思路不借实现。

这里的表示是 `strip_for_schema()`：剥掉 class / style / 内联 svg / script /
注释，保留标签结构、语义属性和文字。

**实测依据**（9 份第 3 步风格的 HTML，均值 23411 字符）：

    class=       9262 字符   39.6%
    style=         33 字符    0.1%
    内联 <svg>   4144 字符   17.7%
    ─────────────────────────────
    合计        13439 字符   57.4%

Tailwind 的 class 汤和图标 svg 占了**近六成字节，对推 schema 零信号**。
剥掉不是省钱，是**降噪**：把模型的注意力从 `px-4 py-2 rounded-lg shadow-sm`
挪到 `<th>设备编号</th>` 上。

### ② source grounding —— 借自 google/langextract

它给每个抽取项记 `char_interval`（在原文里的确切位置），定位不到就判为幻觉，
机械过滤掉：`[e for e in result.extractions if e.char_interval]`。

这里照做：**每个实体、每个字段、每页都必须带 `evidence`——它在 HTML 里的原文**，
校验器逐条回原文找。找不到就是臆造，当场拦。

这条比"在提示词里叮嘱不要编"硬得多，也是本仓一贯的口径：**能机械判的就别靠劝**。
之前几轮实验里"臆造 0"是**观测**出来的，不是**强制**出来的——观测靠运气，
强制靠判据。

## 关联关系为什么不单开一个列表

五系统模型里关联就是 `{"type": "ref", "refEntity": "<实体id>"}` 一个字段，
不是独立的一段。单开一个 `relations: [...]` 让模型填，等于请它凭空发明关系——
而 ref 字段本身是**画面上真有的一列**（工单表里那个「设备」列），天然被
grounding 管住。所以这里不设 relations，关联由 ref 字段承载，校验器只查
`refEntity` 指向的实体真的存在。
"""

from __future__ import annotations

import copy
import re
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

HTML_STRUCTURE_VERSION = "html-structure-v1"

from .spec_llm_call import call_spec_json

#: 字段类型与页型都从合法域账本派生，**不手抄**。
#: 手抄的代价这个仓付过：账本此前记在四处靠人肉对齐，E37 的根因就是漏账。
#
# ⚠ 2026-08-29：这两行原来是自己又开一个 json.loads 去读同一份账本
#   （`_legal()` + `tuple(_LEGAL["fieldTypes"])`）。`schema_legal` 的模块头
#   写着「本模块是唯一入口」，而这就是第五本账——正是上面这条注释自己在
#   警告的形状。值当时没漂（读的是同一个文件），但**第二个解析器就是漂的前提**。
#   顺带：`refine_short_circuit` 原本从这里 import 这两个常量，等于 refine 组
#   为了两个枚举去依赖整条 spec-first 流水线；现在它直接取账本。
from .schema_legal import FIELD_TYPES, PAGE_KINDS  # noqa: F401  （对外名字不变）

_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class DerivedField(BaseModel):
    id: str
    name: str
    type: str
    refEntity: Optional[str] = None
    #: 这个字段在 HTML 里的原文（列头、标签、字段名）。借自 langextract 的
    #: char_interval：定位不到 = 臆造。
    evidence: str

    @field_validator("id")
    @classmethod
    def id_shape(cls, v: str) -> str:
        if not _ID_RE.match(v or ""):
            raise ValueError(f"字段 id '{v}' 不合规：小写字母开头，只能有小写字母/数字/下划线")
        return v

    @field_validator("type")
    @classmethod
    def type_legal(cls, v: str) -> str:
        if v not in FIELD_TYPES:
            raise ValueError(f"字段类型 '{v}' 不在合法域里，只能是 {list(FIELD_TYPES)}")
        return v

    @model_validator(mode="after")
    def ref_needs_target(self) -> "DerivedField":
        if self.type == "ref" and not (self.refEntity or "").strip():
            raise ValueError(f"字段 '{self.id}' 是 ref 类型却没写 refEntity，那是个悬空关联")
        if self.type != "ref" and self.refEntity:
            raise ValueError(f"字段 '{self.id}' 不是 ref 类型，不该带 refEntity")
        return self


class DerivedEntity(BaseModel):
    id: str
    name: str
    fields: List[DerivedField]
    evidence: str

    @field_validator("id")
    @classmethod
    def id_shape(cls, v: str) -> str:
        if not _ID_RE.match(v or ""):
            raise ValueError(f"实体 id '{v}' 不合规：小写字母开头，只能有小写字母/数字/下划线")
        return v

    @model_validator(mode="after")
    def has_fields(self) -> "DerivedEntity":
        if not self.fields:
            raise ValueError(f"实体 '{self.id}' 一个字段都没有——那不是从画面上读出来的")
        ids = [f.id for f in self.fields]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"实体 '{self.id}' 字段 id 重复：{dupes}")
        return self


class DerivedPage(BaseModel):
    id: str
    name: str
    kind: str
    #: 这一页由哪份 HTML 推出来的（第 3 步的 pageId）。不是模型编的，是喂进去时就知道的。
    sourcePageId: str
    #: 版面上分了哪几块（「筛选栏」「工单表格」「车间分布图」这种）。
    #: 只记有哪几块，不记怎么摆——摆法归第 6 步的设计段。
    sections: List[str] = Field(default_factory=list)
    evidence: str

    @field_validator("kind")
    @classmethod
    def kind_legal(cls, v: str) -> str:
        if v not in PAGE_KINDS:
            raise ValueError(f"页型 '{v}' 不在合法域里，只能是 {list(PAGE_KINDS)}")
        return v


class HtmlStructure(BaseModel):
    version: str = HTML_STRUCTURE_VERSION
    entities: List[DerivedEntity]
    pages: List[DerivedPage]

    @model_validator(mode="after")
    def ids_unique_and_refs_resolve(self) -> "HtmlStructure":
        ent_ids = [e.id for e in self.entities]
        dupes = sorted({i for i in ent_ids if ent_ids.count(i) > 1})
        if dupes:
            raise ValueError(f"实体 id 重复：{dupes}")
        page_ids = [p.id for p in self.pages]
        dupes = sorted({i for i in page_ids if page_ids.count(i) > 1})
        if dupes:
            raise ValueError(f"页面 id 重复：{dupes}")
        if not self.entities:
            raise ValueError("一个实体都没推出来——第 4 步的产出不能为空")
        if not self.pages:
            raise ValueError("一个页面都没推出来——第 4 步的产出不能为空")
        known = set(ent_ids)
        for e in self.entities:
            for f in e.fields:
                if f.type == "ref" and f.refEntity not in known:
                    raise ValueError(
                        f"'{e.id}.{f.id}' 的 refEntity 指向 '{f.refEntity}'，"
                        f"但没有这个实体。真实实体是：{sorted(known)}"
                    )
        return self


# ── ① 表示：剥掉对 schema 零信号的部分（借自 llm-scraper 的思路）──────────

_STRIP_BLOCKS = re.compile(
    r"<(script|style|svg|noscript)\b[\s\S]*?</\1>", re.I
)
_STRIP_COMMENT = re.compile(r"<!--[\s\S]*?-->")
_STRIP_ATTR = re.compile(r'\s(?:class|style|srcset|sizes|xmlns|viewBox|fill|stroke)="[^"]*"', re.I)
_COLLAPSE_WS = re.compile(r"[ \t]*\n[ \t]*")
_BLANK_RUNS = re.compile(r"\n{3,}")


def strip_for_schema(markup: str) -> str:
    """把一份 HTML 压成「只剩结构与文字」的表示。

    保留：标签层级、语义属性（id / name / type / placeholder / for / colspan…）、
    所有可见文字。这三样才是推 schema 的信号。

    剥掉：class（Tailwind 汤，实测占 39.6%）、style、内联 svg（图标，17.7%）、
    script、注释。**不用 Readability.js**——它剥导航和侧栏，那正是我们要的东西。
    """
    text = markup or ""
    text = _STRIP_COMMENT.sub("", text)
    text = _STRIP_BLOCKS.sub(lambda m: f"<{m.group(1)}/>", text)
    text = _STRIP_ATTR.sub("", text)
    text = _COLLAPSE_WS.sub("\n", text)
    return _BLANK_RUNS.sub("\n\n", text).strip()


def visible_text(markup: str) -> str:
    """页面上所有可见文字 + 语义属性值，拼成一条便于回查的串。

    grounding 校验拿它当"原文"：一条 evidence 只要在这里面找得到，就说明
    它真的出现在画面上，而不是模型编的。
    """
    text = strip_for_schema(markup)
    attrs = " ".join(re.findall(r'(?:placeholder|title|alt|aria-label|value)="([^"]*)"', text, re.I))
    bare = re.sub(r"<[^>]+>", " ", text)
    return _normalize(bare + " " + attrs)


#: 回查时一律忽略的字符：空白 + 中英文标点。
#:
#: 为什么是"剔掉"而不是"全角转半角"：转换要维护一张对照表，漏一个字符就多一次
#: 误判，而误判在这条判据上比漏判贵得多——它会把**正确**的抽取判成臆造，
#: 逼人把整条 grounding 关掉。剔掉是幂等的，不用维护对照表。
_IGNORE_IN_MATCH = re.compile(r"[\s（）()：:，,、；;。.！!？?「」\"'…—·\-_/|]+")


def _normalize(s: str) -> str:
    """回查前的归一化：空白与标点一律剔掉。

    不这么做的话，模型抄回来的 evidence 只要多一个空格、末尾多个冒号、
    或者用了全角括号，就会被判成臆造。
    """
    return _IGNORE_IN_MATCH.sub("", s or "")


# ── ② grounding：每条 evidence 都要能在原文里找到（借自 langextract）───────


def check_grounding(structure: HtmlStructure, html_by_page: Dict[str, str]) -> List[Dict[str, str]]:
    """逐条把 evidence 拿回 HTML 原文里找，找不到的报出来。

    这是 langextract 那条 `char_interval is None → 幻觉` 的移植版：它记的是
    字符区间，我们只需要"在不在"，所以做成子串包含（归一化之后）。

    ⚠ 回查的语料是**全部页面拼起来**，不是逐页对应。理由：一个实体的字段
    可能分散在多页（工单编号在列表页、故障描述在详情页），按页锁死会把
    正确的抽取判成臆造。
    """
    corpus = _normalize(" ".join(visible_text(h) for h in html_by_page.values()))
    problems: List[Dict[str, str]] = []

    def _check(path: str, ev: str) -> None:
        needle = _normalize(ev)
        if not needle:
            problems.append({"path": path, "message": "evidence 是空的，等于没有依据"})
        elif needle not in corpus:
            problems.append({
                "path": path,
                "message": f"evidence「{ev[:30]}」在任何一份 HTML 里都找不到——这是臆造的",
            })

    for e in structure.entities:
        _check(f"entities[{e.id}]", e.evidence)
        for f in e.fields:
            _check(f"entities[{e.id}].fields[{f.id}]", f.evidence)
    for p in structure.pages:
        _check(f"pages[{p.id}]", p.evidence)
    return problems


def check_page_coverage(
    structure: HtmlStructure, html_by_page: Dict[str, str]
) -> List[Dict[str, str]]:
    """喂进去几份 HTML，就该产出几个页面——**一页都不许少**。

    2026-08-13 全链路实测撞到的：spec 有 5 页、第 3 步出了 5 份 HTML，
    第 4 步只产出 4 个页面，`p5 权限与审计` 被整页丢掉，而**闸全绿**。

    根因是提示词里那条「不要产出权限、角色、工作流」写得太宽——模型看到一个
    叫「权限与审计」的页面，就把整页跳过了。那条本意是"别产出权限**内容**"，
    页面本身是结构，该留。提示词已收窄，但**光靠改提示词不够**：
    这类"东西悄悄少了、判据照样绿"的形状今天出现过不止一次，得有判据兜住。

    也查反向：产出的 sourcePageId 必须是真喂过的页，不能凭空多一个。
    """
    problems: List[Dict[str, str]] = []
    fed = set(html_by_page)
    got = {p.sourcePageId for p in structure.pages}
    for missing in sorted(fed - got):
        problems.append({
            "path": f"pages[{missing}]",
            "message": f"喂了 {missing} 这一页的 HTML，却没有对应的 pages 条目——"
                       f"整页被丢了（哪怕它是「权限与审计」这类页，页面本身也要保留）",
        })
    for extra in sorted(got - fed):
        problems.append({
            "path": f"pages[{extra}]",
            "message": f"sourcePageId '{extra}' 不在喂进来的页面里，真实页面是 {sorted(fed)}",
        })
    return problems


def validate_structure(payload: Any, html_by_page: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """契约校验 + grounding 校验，返回 {passed, findings}。

    两段分开：形状不对就没法做 grounding（拿不到 evidence 字段），所以先形状后接地。
    """
    try:
        structure = (
            payload if isinstance(payload, HtmlStructure) else HtmlStructure.model_validate(payload)
        )
    except ValidationError as exc:
        findings = []
        for err in exc.errors():
            loc = ".".join(str(x) for x in err.get("loc", ())) or "structure"
            findings.append({
                "path": loc,
                "message": str(err.get("msg", "")).replace("Value error, ", ""),
            })
        return {"passed": False, "findings": findings}
    except Exception as exc:  # noqa: BLE001 — 形状完全不对（不是 dict）
        return {"passed": False, "findings": [{"path": "structure", "message": str(exc)[:200]}]}

    findings = check_grounding(structure, html_by_page) if html_by_page else []
    if html_by_page:
        findings += check_page_coverage(structure, html_by_page)
    return {"passed": not findings, "findings": findings}


_FIELD_PATH = re.compile(r"^entities\[([^\]]+)\]\.fields\[([^\]]+)\]$")
_ENTITY_PATH = re.compile(r"^entities\[([^\]]+)\]$")


def prune_ungrounded(
    payload: Any, html_by_page: Dict[str, str]
) -> Tuple[Optional[HtmlStructure], List[str]]:
    """臆造字段/实体剪掉，其余留下。剪完仍过闸才算数。

    2026-08-18 咖啡馆 R5/R10：模型给 drink 加了「所需积分」，画面上没有。
    重问已经写了「抄不回来就把字段删掉」，它不听；整条结构闸失败 →
    spec-first 回落 GEN5 → 版本涨了页还是旧的。

    做法不是新发明：google/langextract 对 `char_interval is None` 的抽取
    是丢那一条，文档还在。本仓 aigc 沿用也是「对不上就剪引用，不整段扔」。
    页面条目不剪——少一页是另一类事故（check_page_coverage），不能靠删页过闸。
    """
    if not isinstance(payload, dict) or not html_by_page:
        return None, []
    try:
        structure = HtmlStructure.model_validate(payload)
    except Exception:  # noqa: BLE001 — 形状都不对，剪无可剪
        return None, []
    findings = check_grounding(structure, html_by_page)
    if not findings:
        # 接地过了但页覆盖/形状可能没过——那种不能当「剪成功」。
        verdict = validate_structure(structure, html_by_page)
        if verdict["passed"]:
            return structure, []
        return None, []
    if any(str(f.get("path") or "").startswith("pages[") for f in findings):
        return None, []

    drop_fields: set[tuple[str, str]] = set()
    drop_entities: set[str] = set()
    dropped: List[str] = []
    for item in findings:
        path = str(item.get("path") or "")
        field_hit = _FIELD_PATH.match(path)
        if field_hit:
            drop_fields.add((field_hit.group(1), field_hit.group(2)))
            dropped.append(path)
            continue
        ent_hit = _ENTITY_PATH.match(path)
        if ent_hit:
            drop_entities.add(ent_hit.group(1))
            dropped.append(path)

    if not dropped:
        return None, []

    data = copy.deepcopy(payload)
    kept_entities = []
    for ent in data.get("entities") or []:
        if not isinstance(ent, dict):
            continue
        eid = str(ent.get("id") or "")
        if eid in drop_entities:
            continue
        fields = [
            f for f in (ent.get("fields") or [])
            if isinstance(f, dict) and (eid, str(f.get("id") or "")) not in drop_fields
        ]
        if not fields:
            dropped.append(f"entities[{eid}]")
            continue
        ent = {**ent, "fields": fields}
        kept_entities.append(ent)
    data["entities"] = kept_entities

    known = {str(e.get("id") or "") for e in kept_entities}
    for ent in kept_entities:
        cleaned = []
        for f in ent.get("fields") or []:
            if str(f.get("type") or "") == "ref" and str(f.get("refEntity") or "") not in known:
                dropped.append(f"entities[{ent.get('id')}].fields[{f.get('id')}]")
                continue
            cleaned.append(f)
        ent["fields"] = cleaned
    data["entities"] = [e for e in kept_entities if e.get("fields")]

    verdict = validate_structure(data, html_by_page)
    if not verdict["passed"]:
        return None, dropped
    return HtmlStructure.model_validate(data), dropped


# ── 生成 ────────────────────────────────────────────────────────────────

_SYSTEM = (
    "你是把已有界面反推成数据结构的架构师。只输出一个 JSON 对象，"
    "不要解释、不要 markdown 围栏。"
)


def build_prev_ids_block(prev_ids: Optional[Dict[str, Any]]) -> str:
    """精修时把上一版的「实体/字段名 → id」摆出来，要求认出同一个就照抄。

    ⚠ 锚是**名字**不是位置：实体顺序每轮都会变，按位置对齐必然错配。
      identifier freezing 的常规做法也是名字锚定（见 spec_first_pipeline.
      model_id_lexicon 的文档串）。

    ⚠ 只在精修轮出现。新建应用没有"上一版"，多这一段等于给模型一批
      跟本轮无关的 id，它会当成必须用上的东西。
    """
    import json as _json

    entities = (prev_ids or {}).get("entities") or []
    if not entities:
        return ""
    return f"""
=== 上一版已经有的实体与字段 id（本轮是在它基础上迭代）===

{_json.dumps(entities, ensure_ascii=False, indent=1)}

**认出同一个东西就照抄它的 id，一个字母都不要改。** 判断依据是 name：
上面叫「老人档案」的实体，这一轮你从画面上又读出「老人档案」，那它的 id
就必须还是上面那个，不许换成近义词（`elder` / `elderly` / `elder_archive`
是同一个东西，换来换去会让所有引用它的地方全部悬空）。字段同理。

真正**新出现**的实体/字段才自己起 id；上一版有而这一轮画面上确实没有的，
不用硬凑进来。
"""


def build_prompt(
    html_by_page: Dict[str, str],
    goal: str = "",
    *,
    prev_ids: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, str]]:
    """装配反推对话。喂进去的是**剥过的 HTML**，不是原件。

    prev_ids（2026-08-17 加）：上一版的 id 词表（spec_first_pipeline.
    model_id_lexicon 的产物）。只在精修轮传，见 build_prev_ids_block。
    """
    blocks = []
    for page_id, markup in html_by_page.items():
        blocks.append(f"—— 页面 {page_id} ——\n{strip_for_schema(markup)}")
    head = f"产品意图：{goal.strip()}\n\n" if goal.strip() else ""
    body = f"""{head}下面是这个产品已经画出来的 {len(html_by_page)} 份界面 HTML。
请**只从这些画面上读**出它背后的数据结构与页面结构。

严格按这个 JSON 形状输出，key 名一字不差：

{{
  "version": "{HTML_STRUCTURE_VERSION}",
  "entities": [
    {{"id": "work_order", "name": "报修工单",
      "evidence": "画面上让你认出这个实体的那段原文（菜单项/标题/表格标题）",
      "fields": [
        {{"id": "order_no", "name": "工单编号", "type": "string",
          "evidence": "工单编号"}},
        {{"id": "equipment_ref", "name": "设备", "type": "ref",
          "refEntity": "equipment", "evidence": "设备"}}
      ]}}
  ],
  "pages": [
    {{"id": "work_order_board", "name": "工单工作台", "kind": "workbench",
      "sourcePageId": "<上面那个页面 id，照抄>",
      "sections": ["筛选栏", "待处理工单表格", "车间分布图"],
      "evidence": "画面上的页面标题原文"}}
  ]
}}

硬性要求（不满足会被机械校验拦下，然后把错误原文喂回给你重做）：

1. **每一条 evidence 必须是画面上真实出现过的原文**，一字不差地抄回来
   （表格列头、表单标签、菜单项、页面标题都行）。校验器会拿它回 HTML 里找，
   **找不到就判为臆造**。宁可少推一个字段，也不要编一条依据。
2. 字段 type 只能是：{", ".join(FIELD_TYPES)}。
3. 关联关系**不单独列**——它就是 type 为 ref 的字段，refEntity 写目标实体的 id。
   refEntity 必须指向你自己在 entities 里列出来的实体。
4. 页面 kind 只能是：{", ".join(PAGE_KINDS)}。
5. sourcePageId 照抄上面给你的页面 id，不要自己改名。
6. sections 只记「这一页分了哪几块」，不记怎么摆、不记颜色尺寸——排版不归你定。
7. **不要产出权限、角色、工作流、审批流、状态机这些内容**。画面上读不出
   那些东西，编出来的一定是行业常识而不是这个产品的真实需求，它们由后一步
   从 SPEC 来。
   ⚠ 但这条只管**内容**，不管**页面**：哪怕某一页就叫「权限与审计」，
   它也必须照样出现在 pages 里（记它的 name / kind / sections 就行，
   不要展开里面的角色和权限清单）。**给你几份 HTML 就要产出几个页面，
   一页都不许少。**
8. **每一份输入的 HTML 都必须对应一个 pages 条目**，sourcePageId 逐一对上。
{build_prev_ids_block(prev_ids)}
{chr(10).join(blocks)}"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


class HtmlStructureError(RuntimeError):
    """反推失败。**故意不提供占位兜底**——一份编出来的结构比没有更糟。"""


def derive_structure(
    html_by_page: Dict[str, str],
    *,
    goal: str = "",
    llm_json_fn: Optional[Callable[[List[Dict[str, str]]], Optional[Dict[str, Any]]]] = None,
    max_reask: int = 2,
    prev_ids: Optional[Dict[str, Any]] = None,
) -> HtmlStructure:
    """从 HTML 反推结构，校验不过就把校验器原话喂回去重问，耗尽则抛。

    ⚠ 失败不回落。第 2 步那份 f-string spec 的教训：一份**永远成功**的假产物，
    看起来跟真的一样、还能过自己的闸，于是没有任何一处会发现它是假的。

    prev_ids（2026-08-17 加）：精修时上一版的实体/字段 id 词表，要求同名概念
    照抄 id。不传就是新建应用那条路，提示词逐字不变。
    """
    if not html_by_page:
        raise HtmlStructureError("没有任何 HTML 可反推")

    messages = build_prompt(html_by_page, goal, prev_ids=prev_ids)
    last = "未调用"
    for attempt in range(max_reask + 1):
        outcome = call_spec_json(messages, llm_json_fn, stage="specfirst.structure")
        payload = outcome.payload
        if payload is None:
            last = outcome.failure or "LLM 没有返回可解析的 JSON"
            # 传输/配额层挂了：没拿到任何东西，没有可以喂回去的内容，而且
            # 下层 call_llm_with_retry 已经退避重试过了。再转两圈是拿重问
            # 额度去做下层刚做完的事——实测 11.6 秒跑完三次尝试就是这个形状。
            if outcome.transport:
                break
        else:
            verdict = validate_structure(payload, html_by_page)
            if verdict["passed"]:
                return HtmlStructure.model_validate(payload)
            last = "；".join(f"{f['path']}：{f['message']}" for f in verdict["findings"][:8])
        if attempt == max_reask:
            break
        import json as _json

        messages = messages + [
            {"role": "assistant", "content": _json.dumps(payload or {}, ensure_ascii=False)[:4000]},
            {
                "role": "user",
                "content": (
                    f"上面这份没通过机械校验，问题是：\n{last}\n\n"
                    "只改错的地方，其余保持原样，重新输出完整 JSON。"
                    "特别注意：evidence 必须是画面上真实出现的原文，抄不回来的那一条"
                    "**就把整个字段删掉**，不要换一句话硬凑。"
                ),
            },
        ]
    # 重问尽了：模型不删臆造字段，就机械代劳（langextract 丢条不丢文档）。
    # 剪完仍过不了闸，才整条失败——不许回落一份假结构。
    pruned, dropped = prune_ungrounded(payload, html_by_page)
    if pruned is not None:
        if dropped:
            print(
                f"[html_structure] 臆造剪掉：{'、'.join(dropped[:8])}，其余过闸"
            )
        return pruned
    raise HtmlStructureError(f"结构反推失败（重问 {max_reask} 次后）：{last}")


def to_datamodel(structure: HtmlStructure) -> Dict[str, Any]:
    """转成五系统模型的 datamodel 段形状（第 6 步汇合时用）。

    evidence 不带过去——它是**这一步的校验依据**，不是数据模型的一部分。
    带过去会污染下游的形状校验（结构闸不认识这个键）。
    """
    return {
        "entities": [
            {
                "id": e.id,
                "name": e.name,
                "fields": [
                    {
                        k: v
                        for k, v in (
                            ("id", f.id),
                            ("name", f.name),
                            ("type", f.type),
                            ("refEntity", f.refEntity),
                        )
                        if v is not None
                    }
                    for f in e.fields
                ],
            }
            for e in structure.entities
        ]
    }


