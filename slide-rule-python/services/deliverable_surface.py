# -*- coding: utf-8 -*-
"""交付物可用面：页面上到底有没有能点、能填的东西。

## 事故（2026-09-06 换模型当场量出来）

同一个题目类型、同一条链路、只换了 LLM 供应商，两轮交付物差三倍：

    话题：小型装修公司工地进度与验收（业主提整改 / 项目经理报进度传验收单 / 老板看预警）

                  页数   总字符   button  input  select textarea  table
    gemini-3.7      3    11 万      38      1      1      0       1
    gemini-3.8      7    29 万     103     22      6      2       7

而两轮的 `publishClosure` **逐字相同**：

    blocked=false  blockerCount=0  skills=6/6  pins=true  tierCounts 全 0

三个角色端（业主 / 项目经理 / 老板）八个功能塞进三页，**加起来一个 form、
零个 textarea、一个 input**——也就是说那套东西没有一处能真正录入，而闸认为
完全合格。用户点「提整改」没有地方填，点「传验收单」没有地方传。

原因是既有的三道闸量的都不是这个：

    evidence     六个技能有没有**交证据**        → 6/6 都交了
    relevance    产出对不对得上**题**            → 对得上
    factoryTodo  产出跳有没有**跑完**            → 跑完了

它们量的是"流程走完没有"，没有一处量"用户真正看到的那一屏能不能用"。
本仓第五条的原话：**判据要落在用户真正看到的东西上，量渲染后的 DOM，
不量源码。** 这个文件补的就是那一条。

⚠ 这条闸的价值不在"这一轮拦没拦"，在**换模型的时候有人会告诉你东西变薄了**。
  没有它，你只会看到"跑得更快了，还是绿的"。

## 抄的是 grok 的哪一处

grok 在编辑工具上**没有**这条（`apply_patch` 写盘后不回读、不比 diff，一个
`-foo`/`+foo` 的自反 patch 照样报 Success）。它把"报告成功但没有可观察产出"
做成一等判据的地方在采样层，`xai-grok-sampling-types/src/conversation.rs:931-958`：

    /// Classify why the response is empty, if it is.
    /// Returns `Some(reason)` when the response has no visible content and no tool calls
    /// (the conditions that trigger resampling).
    pub fn empty_reason(&self) -> Option<crate::error::EmptyReason> { … }

    /// Reasoning-only responses are considered empty so the retry logic resamples.
    pub fn is_empty(&self) -> bool { self.empty_reason().is_some() }

搬过来的是它的**三段式**，三段各有讲究：

1. **量** —— `measure_pages()` 数渲染面，不数字符数。
2. **归类，不是布尔** —— `SurfaceReason` 是枚举。grok 分 `NoVisibleContent`
   与 `ReasoningOnly` 两档，是因为"什么都没有"和"想了很多但没产出"要分开看。
   我们这边 `ReasoningOnly` 的对应物正是本次事故：五系统模型齐全、六技能
   证据齐全、页面上一个输入框——**推理充分不等于产出可用**。
3. **分层处置** —— grok 的 `ReasoningOnly` 触发重采样而不是判死。这里
   `SUBMIT_INTENT_UNSERVED` 拦（该填的地方没有填的入口 = 交付物不成立），
   `ONE_PAGE_PER_ROLE` 只警告（可能是有意的单屏设计）。

## ⚠ 两个必须做对的细节

**① 匹配前先剥掉 script / style / 注释。** 本仓第二条踩过一模一样的形状
（「判据 grep 源码里的标识符，而那个词同时出现在文档字符串里 → 变异后照样
绿」）。生成页里 `<script>` 段落带着 `'<input type=...>'` 这类字符串模板，
不剥就会把"脚本里提到过 input"数成"页面上有 input"——那正好是把这道闸变成
装饰的最快办法。

**② 没有页面时不归本闸管。** `measure()` 返回 `None`（照 grok 的
`Option<EmptyReason>`：没什么可说就是 `None`）。"一页都没画"是既有链路的
问题，本闸不许顺手把它也拦一遍——两个原因混成一条错误信息，下一个人得
自己分辨。
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

# ── 量：先剥惰性内容，再数控件 ────────────────────────────────────────────

#: 剥掉之后才数。见模块头 ⚠①。
_INERT = (
    re.compile(r"<!--.*?-->", re.S),
    re.compile(r"<script\b[^>]*>.*?</script\s*>", re.S | re.I),
    re.compile(r"<style\b[^>]*>.*?</style\s*>", re.S | re.I),
    re.compile(r"<template\b[^>]*>.*?</template\s*>", re.S | re.I),
)


def strip_inert(html: str) -> str:
    """去掉注释 / script / style / template。**数控件之前必须过这一道。**"""
    out = str(html or "")
    for pat in _INERT:
        out = pat.sub(" ", out)
    return out


#: 一个"控件"长什么样。收窄到开标签，避免把 `</button>` 数第二遍。
_TAG_RE = {
    "button": re.compile(r"<button\b", re.I),
    "input": re.compile(r"<input\b", re.I),
    "select": re.compile(r"<select\b", re.I),
    "textarea": re.compile(r"<textarea\b", re.I),
    "form": re.compile(r"<form\b", re.I),
    "table": re.compile(r"<table\b", re.I),
}
_DATA_HOLE_RE = re.compile(r"\sdata-[a-z][a-z0-9-]*\s*=", re.I)
#: `role="button"` / `contenteditable` 这类"不是 <button> 但能点/能填"的写法。
#: 不认它们的话，一个全用 div 拼出来的页面会被判成零控件（假阳性）。
_ROLE_CLICK_RE = re.compile(r"""role\s*=\s*["'](?:button|link|menuitem|tab|switch|checkbox|radio)["']""", re.I)
_ROLE_ENTRY_RE = re.compile(r"""(?:contenteditable\s*=\s*["']true["']|role\s*=\s*["'](?:textbox|combobox|searchbox|spinbutton)["'])""", re.I)


@dataclass(frozen=True)
class PageSurface:
    """一页的渲染面。字段全是**数出来的**，没有一个是估的。"""

    pageId: str
    chars: int = 0
    button: int = 0
    input: int = 0
    select: int = 0
    textarea: int = 0
    form: int = 0
    table: int = 0
    dataHoles: int = 0
    roleClick: int = 0
    roleEntry: int = 0

    @property
    def entry(self) -> int:
        """能**录入**的控件数。这是本闸最核心的一个数。"""
        return self.input + self.select + self.textarea + self.roleEntry

    @property
    def clickable(self) -> int:
        return self.button + self.roleClick

    @property
    def interactive(self) -> int:
        return self.clickable + self.entry

    def as_dict(self) -> Dict[str, Any]:
        return {
            "pageId": self.pageId,
            "chars": self.chars,
            "button": self.button,
            "input": self.input,
            "select": self.select,
            "textarea": self.textarea,
            "form": self.form,
            "table": self.table,
            "dataHoles": self.dataHoles,
            "roleClick": self.roleClick,
            "roleEntry": self.roleEntry,
            "entry": self.entry,
            "interactive": self.interactive,
        }


def measure_page(page_id: str, html: Any) -> PageSurface:
    body = strip_inert(html)
    counts = {name: 0 for name in _TAG_RE}
    counts.update(dataHoles=0, roleClick=0, roleEntry=0)

    class Parser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack = []

        def handle_starttag(self, tag, pairs):
            attrs = dict(reversed(pairs))
            hidden = "hidden" in attrs or "inert" in attrs or any(row[1] for row in self.stack)
            disabled = "disabled" in attrs or any(row[2] for row in self.stack)
            if not hidden:
                counts["dataHoles"] += sum(key.startswith("data-") for key in attrs)
                editable = not disabled and "readonly" not in attrs and attrs.get("aria-readonly") != "true"
                if tag in counts and (tag not in ("button", "input", "select", "textarea") or editable):
                    if tag != "input" or (attrs.get("type") or "text").lower() not in ("hidden", "submit", "reset", "button", "image"):
                        counts[tag] += 1
                if editable:
                    counts["roleClick"] += int(attrs.get("role") in ("button", "link", "tab", "menuitem"))
                    counts["roleEntry"] += int(attrs.get("role") in ("textbox", "combobox", "searchbox", "spinbutton") or attrs.get("contenteditable") in ("", "true"))
            if tag not in ("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"):
                self.stack.append((tag, hidden, disabled and tag == "fieldset"))

        def handle_endtag(self, tag):
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    break

        def handle_startendtag(self, tag, pairs):
            self.handle_starttag(tag, pairs)
            self.handle_endtag(tag)

    parser = Parser()
    parser.feed(body)
    parser.close()
    return PageSurface(
        pageId=str(page_id),
        chars=len(str(html or "")),
        **counts,
    )


# ── 归类：枚举，不是布尔（照 grok EmptyReason）────────────────────────────


class SurfaceReason(str, Enum):
    """交付物不可用的原因。**归类而不是布尔**——原因决定处置。

    照 grok `EmptyReason::{NoVisibleContent, ReasoningOnly}`：它把"什么都没有"
    和"想了很多但没产出"分成两档，因为处置不同。这里同理。
    """

    #: 有提交类需求节点，而它的**全部**承载页面都零录入控件。**拦。**
    SUBMIT_INTENT_UNSERVED = "submit_intent_unserved"
    #: 提交类需求一个承载页都没声明。**只警告**——那是 SPEC 覆盖问题，
    #: 不是渲染面问题，本闸不许越界去拦别人家的病（见 measure() 注释）。
    SUBMIT_INTENT_UNMAPPED = "submit_intent_unmapped"
    #: 没有任何录入控件，且 SPEC 也没说要录入。可能是有意的只读看板 → 只警告。
    NO_ENTRY_SURFACE = "no_entry_surface"
    #: 角色数 >= 页面数（每个角色只摊到一屏）。**警告。**
    ONE_PAGE_PER_ROLE = "one_page_per_role"
    #: 某一页零可交互控件（既不能点也不能填）。**警告。**
    PAGE_WITHOUT_CONTROLS = "page_without_controls"


#: 原因 → 分层。hard_blocker 参与 blocked；warning 只透出。
_TIER: Dict[SurfaceReason, str] = {
    SurfaceReason.SUBMIT_INTENT_UNSERVED: "hard_blocker",
    SurfaceReason.SUBMIT_INTENT_UNMAPPED: "warning",
    SurfaceReason.NO_ENTRY_SURFACE: "warning",
    SurfaceReason.ONE_PAGE_PER_ROLE: "warning",
    SurfaceReason.PAGE_WITHOUT_CONTROLS: "warning",
}

#: 本模块发出的全部 blocker code。**arch_graph.gate_inventory 认这个名字**
#: （见 arch_graph._BLOCKER_CODE_DECLS）——因为下面 `_CODE` 是查表，
#: `{"code": _CODE[reason]}` 里的值是下标表达式而不是字符串常量，AST 扫不到。
#: 少了这一行，新加的 5 条拦截理由会整个漏出 `[gate_codes]` 注册纪律，
#: 而 `--check` 照样绿——一道漏筛的闸看着跟装好了一模一样。
#:
#: ⚠ 它与 `_CODE` 是同一份事实的两处书写，靠判据钉住不许漂：
#:   tests/test_deliverable_surface_gate.py::test_声明的code跟真正发出的一致
BLOCKER_CODES = (
    "CLOSURE_NO_ENTRY_SURFACE",
    "CLOSURE_ONE_PAGE_PER_ROLE",
    "CLOSURE_PAGE_WITHOUT_CONTROLS",
    "CLOSURE_SUBMIT_INTENT_UNMAPPED",
    "CLOSURE_SUBMIT_INTENT_UNSERVED",
)

#: 原因 → blocker code。形状受 arch_graph._BLOCKER_CODE_RE 约束，
#: 且**每一条都必须在 architecture.toml 的 [gate_codes] 里声明归属**，
#: 否则 `arch_graph.py --check` 变红（这是本仓逼人回答"谁体检它"的机制）。
_CODE: Dict[SurfaceReason, str] = {
    SurfaceReason.SUBMIT_INTENT_UNSERVED: "CLOSURE_SUBMIT_INTENT_UNSERVED",
    SurfaceReason.SUBMIT_INTENT_UNMAPPED: "CLOSURE_SUBMIT_INTENT_UNMAPPED",
    SurfaceReason.NO_ENTRY_SURFACE: "CLOSURE_NO_ENTRY_SURFACE",
    SurfaceReason.ONE_PAGE_PER_ROLE: "CLOSURE_ONE_PAGE_PER_ROLE",
    SurfaceReason.PAGE_WITHOUT_CONTROLS: "CLOSURE_PAGE_WITHOUT_CONTROLS",
}

#: "这个需求要用户往里填东西"的词。只在 requirement 节点的 title/acceptance 上找。
#:
#: ⚠ 别往里加"查看""浏览""统计"这类——那是只读意图，加进来会让纯看板应用
#:   被误拦。也别加单字"报"：`报表` / `预警` 会误命中。
_SUBMIT_WORDS = (
    "提交", "录入", "填写", "填报", "上传", "新增", "添加", "创建", "登记",
    "申请", "报名", "编辑", "修改", "发起", "审批", "确认", "反馈", "整改",
    "上报", "报备", "下单", "预约", "签到", "点名", "打卡", "备注", "评价",
)


def _spec_of(state: Any) -> Dict[str, Any]:
    blob = getattr(state, "specFirstPages", None)
    if not isinstance(blob, dict):
        return {}
    spec = blob.get("spec")
    return spec if isinstance(spec, dict) else {}


def _pages_of(state: Any) -> Dict[str, Any]:
    blob = getattr(state, "specFirstPages", None)
    if not isinstance(blob, dict):
        return {}
    pages = blob.get("pages")
    return pages if isinstance(pages, dict) else {}


#: EARS 中文验收的分句标记：`当…时，**系统应**…`。
#: 标记**之前**是触发条件（用户/环境做了什么），之后是系统自己要做的事。
_SYSTEM_CLAUSE_MARKERS = ("系统应", "系统将", "系统会", "系统需", "则系统", "系统自动")

#: 动词前面挂着这些字，说明它在描述**条件**而不是**用户动作**：
#:   未签到 / 没提交 / 无上传 —— 否定
#:   被举报 / 被审批            —— 被动
#: ⚠ 只看紧邻左侧一个字。放宽到"整句里出现过否定词"会把
#:   「先上传证明，未通过则重新上传」这种真需要上传口的需求也排掉。
_NON_ACTION_PREFIX = ("未", "没", "无", "非", "被", "免")


def _trigger_clause(acceptance: str) -> str:
    """取 EARS 验收的触发从句（`系统应…` 之前那半截）。

    找不到标记就返回原文——判不出来的时候倾向于**算作提交意图**（宁可多拦
    也不放过），跟这道闸整体的取向一致。
    """
    text = str(acceptance or "")
    cut = len(text)
    for marker in _SYSTEM_CLAUSE_MARKERS:
        i = text.find(marker)
        if 0 <= i < cut:
            cut = i
    return text[:cut] if cut < len(text) else text


def _has_user_submit_action(text: str) -> bool:
    """这段话里有没有**用户主动**的录入/提交动作。

    命中的动词紧邻左侧是否定或被动标记时不算——那是在说条件。
    """
    for word in _SUBMIT_WORDS:
        start = 0
        while True:
            i = text.find(word, start)
            if i < 0:
                break
            prefix = text[i - 1] if i > 0 else ""
            if prefix not in _NON_ACTION_PREFIX:
                return True
            start = i + 1
    return False


def submit_intent_nodes(spec: Dict[str, Any]) -> List[str]:
    """SPEC 里"要用户往里填东西"的需求节点 id。

    只看 `type == "requirement"` 的 title + acceptance：evidence 节点是取证
    记录、design 节点是实现笔记，两者出现"上传"不代表交付面要有上传口。

    ## ⚠ 只看触发从句，且排除否定/被动（2026-09-06 第二轮真机喂出来的）

    第一版是「title + acceptance 全文里出现任一提交动词」。真机（校区自习室
    座位预约）当场误报，把一份**合格**交付物拦了下来：

        n1 座位预约与扫码签到    触发：学生**选择**座位、**扫描**座位码   真要录入 ✔
        n2 信用分奖惩与自动封禁  触发：学生**发生**违约（迟到**未**签到、
                                      **被**举报）→ 系统**自动**封禁      不该要 ✘
        n3 拍照举报              触发：学生**拍照上传**举报               真要录入 ✔
        n4 分区时段与报表        触发：管理员**调整**分区                 真要录入 ✔

    四条 requirement 全被判成"需要录入"——**等于没有区分度**。而 n2 承载在
    「我的预约与信用分」这张只读页上（0 input / 0 select / 13 button），
    它本来就不该有输入框：验收写的是"系统应自动…并在小程序端**提示**"。
    于是 `blocked=True`、`blockerCount=1`，一份三条真需求都被正确服务的交付物
    被拦住了。

    一道会误报的 hard_blocker 的结局是**被人关掉**，那就等于白做——同
    `_ENRICH_STAGE_LABELS` 头注那句「写窄的提示比不写更糟：它把正常说成异常」。

    两条规则合起来正好把这四条分开：

      ① 只看**触发从句**（`系统应` 之前）。`系统应自动释放座位` 里的动词是
         系统的活，不是用户的落笔处。
      ② 从句里命中的动词，紧邻左侧是否定/被动标记（未/没/无/非/被/免）时
         不算。n2 的 `迟到**未**签到`、`**被**举报` 说的是条件。

    ⚠ 遗留（不在这一刀里）：n4 目前是靠 `可预约时段` 里的 `预约` 命中的，
      它真正的用户动作是 `调整` / `筛选` / `划分`，而这几个词不在
      `_SUBMIT_WORDS` 里。也就是说 n4 的分类站在一次偶然匹配上。要不要把
      管理类动词加进词表是**另一个决定**（`筛选` 会让纯看板应用也要求有
      select，那未必是错的，但影响面不同），单独议。这里只加排除规则、不加词。

    ⚠ **根节点必须排除**（2026-09-06 真机喂出来的）。厚那一轮的 `n0` 是
      umbrella 需求（「当教务人员、老师与家长登录对应终端时，系统应支持
      基于同一套档案进行排课、**点名**、记账与查验」），`rootNodeId` 就是它。
      它按设计不被任何页面承载——把它算进来会让**每一份**合格交付物都报
      「有需求没落笔的地方」，也就是一道天天开火的闸。gate_health 头注里
      那句「一道一直给同一个结论的闸，等于没在量东西」说的正是这种。
    """
    root = str(spec.get("rootNodeId") or "").strip()
    out: List[str] = []
    for node in spec.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        if str(node.get("type") or "").strip().lower() != "requirement":
            continue
        nid = str(node.get("id") or "").strip()
        if not nid or (root and nid == root):
            continue
        text = f"{node.get('title') or ''}\n{_trigger_clause(node.get('acceptance'))}"
        if _has_user_submit_action(text):
            out.append(nid)
    return out


def pages_covering(spec: Dict[str, Any], node_id: str) -> List[str]:
    """SPEC 里声明承载 `node_id` 的页面 id。"""
    out: List[str] = []
    for page in spec.get("pages") or []:
        if not isinstance(page, dict):
            continue
        covers = page.get("coversNodes")
        if isinstance(covers, list) and node_id in [str(c) for c in covers]:
            pid = str(page.get("id") or "").strip()
            if pid:
                out.append(pid)
    return out


def unserved_submit_intents(
    spec: Dict[str, Any], by_page: Dict[str, PageSurface]
) -> List[Dict[str, Any]]:
    """提交类需求里，**没有任何一个承载页提供录入口**的那些。

    ## 为什么是「按页对账」而不是「全局总数 > 0 就算过」

    2026-09-06 第一版写的是 `totalEntry == 0` 才拦。拿真机那一发喂进去当场
    发现它咬不住——3 页里有 1 页带着 1 个 input + 1 个 select，全局总数是 2，
    于是闸放行，而真正出事的两页（提交施工播报、提交验收单/上传整改照片）
    **各自都是 0**。本仓「护栏装对了地方，条件却永远不成立」那条的又一例：
    判据装在闭环上没错，阈值却设成了真机永远达不到的那一档。

    ## 为什么是「任一承载页有就算服务到了」而不是「每个承载页都要有」

    同样是真机喂出来的。厚那一轮 `n4`（老师/校长**录入**实收金额，家长
    **核对**缴费历史）被两个页面承载：`p3` 收费台账页有 7 个录入控件、
    `p7` 家长账单页 0 个。`p7` 服务的是同一条需求的**只读那一半**——要求
    每个承载页都有录入口会把它判成违规，那是误报。

    所以口径是：**这条需求在交付面上至少有一处能落笔**。
    """
    out: List[Dict[str, Any]] = []
    for nid in submit_intent_nodes(spec):
        covers = pages_covering(spec, nid)
        served = [pid for pid in covers if (by_page.get(pid) or PageSurface(pid)).entry > 0]
        if served:
            continue
        out.append({
            "nodeId": nid,
            # 一个页面都没声明承载它，比"承载了但没入口"更糟——两种都算未服务，
            # 但要能分出来，否则修的人不知道该加页还是该加控件。
            "coveredBy": covers,
            "why": "no_covering_page" if not covers else "covering_pages_have_no_entry",
        })
    return out


def role_count(state: Any, spec: Dict[str, Any]) -> int:
    """角色数。先认落库的五系统 rbac.roles，没有就退回 SPEC personas。

    ⚠ 两个来源都要认：rbac 是收口之后才有的，而本闸在收口那一刻跑——
      首轮拿不到 rbac 时 personas 是唯一的角色事实。只认一个来源等于
      在最需要它的那一发上恒为 0（本仓「护栏依赖的输入在真机上不出现」那条）。
    """
    versions = getattr(state, "modelVersions", None) or []
    if versions:
        model = (versions[-1] or {}).get("model") if isinstance(versions[-1], dict) else None
        roles = ((model or {}).get("rbac") or {}).get("roles") if isinstance(model, dict) else None
        if isinstance(roles, list) and roles:
            return len(roles)
    personas = spec.get("personas")
    if isinstance(personas, list):
        return len(personas)
    return 0


@dataclass
class SurfaceMeasurement:
    """一次交付物可用面的完整量结果 + 归类结果。"""

    pages: List[PageSurface] = field(default_factory=list)
    roleCount: int = 0
    submitIntentNodes: List[str] = field(default_factory=list)
    unserved: List[Dict[str, Any]] = field(default_factory=list)
    reasons: List[SurfaceReason] = field(default_factory=list)

    @property
    def pageCount(self) -> int:
        return len(self.pages)

    @property
    def totalEntry(self) -> int:
        return sum(p.entry for p in self.pages)

    @property
    def totalClickable(self) -> int:
        return sum(p.clickable for p in self.pages)

    def as_dict(self) -> Dict[str, Any]:
        """写进 publishClosure 的形状。**数字先行，结论在后**——事后要能
        自己复核判定，而不是只看到一个 blocked。"""
        return {
            "pageCount": self.pageCount,
            "roleCount": self.roleCount,
            "totalEntryControls": self.totalEntry,
            "totalClickableControls": self.totalClickable,
            "pagesWithoutEntry": [p.pageId for p in self.pages if p.entry == 0],
            "submitIntentNodeCount": len(self.submitIntentNodes),
            "submitIntentNodes": self.submitIntentNodes[:12],
            # 未被服务的提交类需求：本闸最核心的证据，带上承载页与原因，
            # 修的人不用重跑就知道该加页还是该加控件。
            "unservedSubmitIntents": self.unserved[:12],
            "perPage": [p.as_dict() for p in self.pages],
            "reasons": [r.value for r in self.reasons],
            "hardBlockerReasons": [
                r.value for r in self.reasons if _TIER[r] == "hard_blocker"
            ],
        }


def measure(state: Any) -> Optional[SurfaceMeasurement]:
    """量 + 归类。**没有页面就返回 None**（照 grok 的 `Option<EmptyReason>`：
    没什么可说就别说）。见模块头 ⚠②。"""
    pages_blob = _pages_of(state)
    if not pages_blob:
        return None
    spec = _spec_of(state)
    surfaces = [measure_page(pid, html) for pid, html in sorted(pages_blob.items())]
    by_page = {p.pageId: p for p in surfaces}
    m = SurfaceMeasurement(
        pages=surfaces,
        roleCount=role_count(state, spec),
        submitIntentNodes=submit_intent_nodes(spec),
        unserved=unserved_submit_intents(spec, by_page),
    )
    reasons: List[SurfaceReason] = []
    # 这是本次事故那一档：SPEC 说要填，承载它的页面上没有填的地方。
    # 按页对账，不看全局总数——理由见 unserved_submit_intents 头注。
    #
    # ⚠ 两种"未服务"分开处置，**因为修法不同，也因为本闸只管渲染面**：
    #     covering_pages_have_no_entry  承载页在、但没有录入口   → 生成侧漏了表单，拦
    #     no_covering_page              一个承载页都没声明       → SPEC 覆盖问题，只警告
    #   把后者也拦了就是越界：那道病该由覆盖闸管，两个原因塞进一条错误信息，
    #   下一个人得自己分辨该加页还是该加控件（本仓 orphan_reason_gaps 同一条纪律）。
    if any(row.get("why") == "covering_pages_have_no_entry" for row in m.unserved):
        reasons.append(SurfaceReason.SUBMIT_INTENT_UNSERVED)
    if any(row.get("why") == "no_covering_page" for row in m.unserved):
        reasons.append(SurfaceReason.SUBMIT_INTENT_UNMAPPED)
    if not m.unserved and m.totalEntry == 0 and not m.submitIntentNodes:
        # 整份零录入且 SPEC 也没说要录入：可能是有意的只读看板，只警告。
        reasons.append(SurfaceReason.NO_ENTRY_SURFACE)
    # 角色数 >= 页面数 = 每个角色只摊到一屏。3 个角色 3 个页面正是实测那一发。
    if m.roleCount >= 2 and m.pageCount <= m.roleCount:
        reasons.append(SurfaceReason.ONE_PAGE_PER_ROLE)
    if any(p.interactive == 0 for p in m.pages):
        reasons.append(SurfaceReason.PAGE_WITHOUT_CONTROLS)
    m.reasons = reasons
    return m


def surface_reason(state: Any) -> Optional[SurfaceReason]:
    """最严重的那个原因，没有就 None。对应 grok 的 `empty_reason()`。"""
    m = measure(state)
    if m is None or not m.reasons:
        return None
    for r in m.reasons:
        if _TIER[r] == "hard_blocker":
            return r
    return m.reasons[0]


def is_thin(state: Any) -> bool:
    """交付物薄到不该判合格吗。对应 grok 的 `is_empty()`。"""
    r = surface_reason(state)
    return r is not None and _TIER[r] == "hard_blocker"


# ── 处置：分层 findings ──────────────────────────────────────────────────

_MESSAGE: Dict[SurfaceReason, str] = {
    SurfaceReason.SUBMIT_INTENT_UNSERVED: (
        "{blocked_n} 条需要用户录入/提交的需求，其承载页面上**没有任何落笔的地方**："
        "{blocked_detail}。（这些页面的 input/select/textarea 均为 0；"
        "本轮共 {pages} 页，其中零录入页：{noentry}）"
    ),
    SurfaceReason.SUBMIT_INTENT_UNMAPPED: (
        "{unmapped_n} 条需要用户录入/提交的需求没有任何页面声明承载（{unmapped_ids}）。"
        "这是 SPEC 覆盖问题而非渲染面问题，本闸只报不拦。"
    ),
    SurfaceReason.NO_ENTRY_SURFACE: (
        "{pages} 个交付页面零个录入控件。若本应用确实是只读看板则属正常，"
        "否则说明生成侧把表单面漏掉了。"
    ),
    SurfaceReason.ONE_PAGE_PER_ROLE: (
        "{roles} 个角色只摊到 {pages} 个页面（每个角色约一屏）。"
        "多角色系统通常需要按角色再分主次页，否则一屏塞下全部功能。"
    ),
    SurfaceReason.PAGE_WITHOUT_CONTROLS: (
        "有页面既不能点也不能填（可交互控件为 0）：{blank}。"
    ),
}


def _message(reason: SurfaceReason, m: SurfaceMeasurement) -> str:
    blank = ", ".join(p.pageId for p in m.pages if p.interactive == 0)
    noentry = ", ".join(p.pageId for p in m.pages if p.entry == 0)
    blocked_rows = [r for r in m.unserved if r.get("why") == "covering_pages_have_no_entry"]
    unmapped_rows = [r for r in m.unserved if r.get("why") == "no_covering_page"]
    return _MESSAGE[reason].format(
        n=len(m.submitIntentNodes),
        blocked_n=len(blocked_rows),
        blocked_detail="；".join(
            f"{r['nodeId']}→{'/'.join(r['coveredBy'])}" for r in blocked_rows[:4]
        ) or "-",
        unmapped_n=len(unmapped_rows),
        unmapped_ids=", ".join(r["nodeId"] for r in unmapped_rows[:6]) or "-",
        ids=", ".join(m.submitIntentNodes[:4]) or "-",
        pages=m.pageCount,
        roles=m.roleCount,
        blank=blank or "-",
        noentry=noentry or "-",
    )


def surface_findings(
    state: Any,
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """`(量结果, hard_blockers, warnings)`。

    返回三份而不是一个 blocked：**结论只是结论，过程要交付**。调用方把
    hard_blockers 并进 `blockers` / `findingsByTier.hard_blocker`，warnings
    并进 `findingsByTier.warning`，量结果原样挂在闭环上。
    """
    m = measure(state)
    if m is None:
        return None, [], []
    hard: List[Dict[str, Any]] = []
    warn: List[Dict[str, Any]] = []
    for reason in m.reasons:
        entry = {
            "code": _CODE[reason],
            "path": "deliverableSurface.perPage",
            "affectedSkill": "page",
            "ref": _message(reason, m)[:400],
        }
        (hard if _TIER[reason] == "hard_blocker" else warn).append(entry)
    return m.as_dict(), hard, warn


def surface_fingerprint(measurement: Optional[Dict[str, Any]]) -> str:
    """给 gate_health 用的指纹：**结论 + 量化结果**，不掺会话 id。

    掺了会话 id 每次都不一样，连击永远不触发——那等于装了个不会响的报警器
    （gate_health.record_verdict 头注的原话）。
    """
    if not measurement:
        return "no-pages"
    return (
        f"{','.join(measurement.get('reasons') or []) or 'clear'}"
        f"@p{measurement.get('pageCount')}"
        f"/e{measurement.get('totalEntryControls')}"
        f"/r{measurement.get('roleCount')}"
    )


__all__ = [
    "BLOCKER_CODES",
    "PageSurface",
    "SurfaceMeasurement",
    "SurfaceReason",
    "is_thin",
    "measure",
    "measure_page",
    "pages_covering",
    "role_count",
    "strip_inert",
    "submit_intent_nodes",
    "surface_findings",
    "surface_fingerprint",
    "surface_reason",
    "unserved_submit_intents",
]
