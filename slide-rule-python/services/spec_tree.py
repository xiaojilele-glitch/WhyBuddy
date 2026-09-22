"""真 spec：把一句话变成一份**能被下游对着检查**的规格（2026-08-13）。

## 为什么要有这个文件

在它之前，`capability_maps.execute_structure` 产出的 spec_tree 是 f-string 拼的：

    req_text   = f"Implement scoped permission checks for {goal}"
    risk_text  = f"Privilege escalation via inheritance in {goal}"
    deliv_text = f"SPEC tree + traceability for {goal} MVP"

恒定 1 需求 1 风险 1 交付物——**换什么题材，那条唯一的需求都是同一句英文**。
底下 G_SCHEMA / G_INV 两道闸在校验这棵树，校验的是**代码上一行刚拼出来的
形状**，所以恒过。拼完存进 artifacts 给人看，不喂给任何生成。

而系统真正的输入是 `generate_five_system_model(goal: str)` 里那一个字符串：
一个 LLM 调用要从 55~100 个字里同时发明实体 / 字段 / 枚举 / 页面 / 权限 /
工作流 / 不变式，还要从 316 个区块里选型。病不在那个调用写得不好，在**它
上游是空的**。这个文件就是来把上游填上的。

## 形状照谁

照 `experiments/visual-first/materials/spec_tree.json`（用户给的参照件，
fingerprint `crm-followup-spec-20260604`）：`successCriteria` + 一棵
requirement / design / task / evidence 的节点树，requirement 带 EARS 形式的
`acceptance`，并用 `coversCriteria` 回指成功判据。这套分层跟 GitHub spec-kit /
Amazon Kiro 的 requirements-design-tasks 三件套是同一个口径，不自创。

**加了一样参照件没有的：`pages`（页面清单）。** 参照件里页面只隐含在 design
节点标题里（「客户创建抽屉表单」「客户详情时间轴」），下游第 3 步要按页逐张
写出图提示词，隐含的推不出来——不知道要并发出几张图、每张画什么。所以显式化。
它是**粗粒度**的（有哪几页 / 给谁用 / 干什么），跟五系统模型里那份细的
（kind / stats / charts / blocks / 绑定）不是一回事，因此不构成循环依赖。

## 闸必须真的会拦

这是跟被替换那份最要紧的区别。那份的闸校验的是自己刚拼出来的形状，恒过；
这里的树级校验每一条都能真失败——孤儿判据、悬空引用、成环、requirement 缺
acceptance、页面指向不存在的节点。**一条闸如果不可能失败，它就不是闸。**
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, Optional

from sliderule_llm.structured import lenient_string_list

from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)

SPEC_VERSION = 3

# EARS 判据跟 slide_rule_trust._count_ears_like 的中文分支同源：`(当|若|如果)…(应|必须|须)`。
# 两处必须对得上——那边是产物质量闸真正会拿去数的正则，这边只是提前拦住，
# 免得生成完了才在信任层被打回来（那时候已经烧掉一次调用）。
_EARS_CN = re.compile(r"(当|若|如果)[^。\n]{2,80}(应|必须|须)")


#: 产品名里不许出现的纯类目词。单独一个「系统」「平台」不是名字，是品类——
#: 壳上挂它等于没起名，而且每次生成都会撞脸。
_GENERIC_APP_NAMES = {"系统", "平台", "管理系统", "管理平台", "应用", "工具", "后台"}

#: 生成方自己的名字。模型常把宿主品牌写成 appName，unify 之后每一页顶栏
#: / 面包屑都变成「面团AI系统」（2026-08-21 素材雷达）。
#: ⚠ 2026-08-29：牌子判定与它的两张表搬到了叶子 services/page_naming。
#:   原因是 page_shell 也要用它，而 spec_tree 又要用 page_shell.nav_tab_label——
#:   两边互相 import，是个真的循环依赖，只好各自把 import 藏进函数体。
#:   共用件下沉成叶子之后方向就顺了（抄 grok 的叶子 crate，见 page_naming 模块头）。
#:   这里保留同名转出：`from services.spec_tree import is_host_brand_name`
#:   这类既有写法照常有效——搬家只该改依赖方向，不该把别人的调用点弄红。
from services.page_naming import is_host_brand_name  # noqa: F401


class Persona(BaseModel):
    """一类使用者。形状照 `experiments/visual-first/materials/clarified_brief.json`
    （用户给的参照件，fingerprint crm-followup-spec-20260604）里的 personas。

    ⚠ 不是照 GitHub spec-kit 抄的——查过了，spec-kit 的 spec-template.md **没有**
    persona 这一节，也没有产品名（只有 `# Feature Specification: [FEATURE NAME]`，
    那是功能名不是产品名）。这两项在开源里没有现成约定，所以照本项目自己的
    参照件走，并在这里注明来源，免得下次有人以为它有出处。

    `name` 是**角色名**（「维修主管」「个人销售」），不是某个人的名字——
    界面上那个「李主管」是占位数据，不该进 spec。
    """

    id: str
    name: str
    goals: list[str] = Field(default_factory=list)

    @field_validator("id", "name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("persona 的 id 和 name 都不能为空")
        return v.strip()


class SuccessCriterion(BaseModel):
    """一条可验收的成功判据。整棵树最后都要回指到它们身上。"""

    id: str
    text: str

    @field_validator("id", "text")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("成功判据的 id 和 text 都不能为空")
        return v.strip()


class SpecAssumption(BaseModel):
    """起草这份 spec 时，需求里没说、模型**替用户定了**的一件事。

    ⚠ 这不是"再问一轮"，跟控制面的 clarify 是两件事，别合并：

      clarify 跑在点火**之前**，拦在用户和工厂中间，它能问的只有
      「这句话里读不出来的维度」（谁用/在哪用/核心流程/本期边界，
      见 rehearsal_control._SPEC_DIMENSIONS）——因为那时候还没人开始画，
      更细的分叉根本还不存在。

      而真正会让产品长得不一样的分叉——员工登录用手机号还是工号、审批一级
      还是两级、库存扣减在下单时还是发货时——是**画到这一步才浮出来的**。
      它们此前一直是静默的：模型自己定了，一个字都不说，用户十分钟后打开
      成品才发现做错了，然后从头精修一轮。

      这个字段就是那句没说出口的话。**它不拦**：模型该怎么定还怎么定，
      spec 照常往下走，只是把定的内容如实报出来，前端非阻塞地摆在旁边，
      用户想改就接进中途排队（本轮结束自动发出）。
      "报出来"是增强，坏了不许拖垮主链路 → 见 _sanitize_assumptions。
    """

    id: str
    #: 这件事是什么。人话短语，「员工怎么登录」不是「认证方案」。
    topic: str
    #: 你定成了什么。「手机号 + 短信验证码」。
    decision: str
    #: 这个行业里真的会有人选的其他做法。前端把它们摆成可点的选项。
    alternatives: list[str] = Field(default_factory=list)
    #: 为什么这么定。一句话。
    why: str = ""

    @field_validator("id", "topic", "decision")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("假设的 id / topic / decision 都不能为空")
        return v.strip()


class SpecNode(BaseModel):
    """规格树的一个节点。四种类型各有自己的必填字段——空壳节点不算数。"""

    id: str
    parentId: Optional[str] = None
    type: Literal["requirement", "design", "task", "evidence"]
    title: str
    # requirement：EARS 形式的验收条件
    acceptance: Optional[str] = None
    # design：怎么做的说明
    notes: Optional[str] = None
    # task：怎么验证做完了
    verify: Optional[str] = None
    # evidence：这条依据从哪来
    source: Optional[str] = None
    coversCriteria: list[str] = Field(default_factory=list)
    evidenceRefs: list[str] = Field(default_factory=list)

    @field_validator("id", "title")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("节点的 id 和 title 都不能为空")
        return v.strip()

    @model_validator(mode="after")
    def required_by_type(self) -> "SpecNode":
        """按类型查必填字段。

        不这么查的话，模型很容易产出一堆只有标题的节点——数量好看，
        但下游一条也用不上：requirement 没有 acceptance 就没法验收，
        design 没有 notes 就只是个名字，evidence 没有 source 就是凭空断言。
        """
        need = {
            "requirement": ("acceptance", "验收条件"),
            "design": ("notes", "设计说明"),
            "task": ("verify", "验证方式"),
            "evidence": ("source", "来源"),
        }[self.type]
        field, label = need
        if not (getattr(self, field) or "").strip():
            raise ValueError(f"{self.type} 节点 '{self.id}' 缺 {field}（{label}）")
        if self.type == "requirement" and not _EARS_CN.search(self.acceptance or ""):
            raise ValueError(
                f"requirement 节点 '{self.id}' 的 acceptance 不是 EARS 形式，"
                f"要写成「当…时，系统应…」：{(self.acceptance or '')[:40]}"
            )
        return self


class SpecPage(BaseModel):
    """粗粒度的一页。第 3 步按它逐页写出图提示词，所以 purpose 要能画得出来。"""

    id: str
    name: str
    purpose: str
    audience: str
    coversNodes: list[str] = Field(default_factory=list)

    @field_validator("id", "name", "purpose", "audience")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("页面的 id / name / purpose / audience 都不能为空")
        return v.strip()


class SpecTree(BaseModel):
    rootNodeId: str
    version: int = SPEC_VERSION
    #: 产品名。2026-08-13 补——在它之前，页面外壳上的产品名是**每页各编一个**的：
    #: 同一份 spec 的三页量出来是「智维工单」「维保云」「智维运维平台」，
    #: 三个产品名三个登录人三套菜单，根本不像同一个应用。页面清单能锚住菜单，
    #: 锚不住这两样，所以补进契约。
    appName: str
    #: 使用者类型。壳上那个登录身份从 personas[0] 来（谁排第一谁是默认身份，
    #: 不另设 primaryPersonaRef——少一个旋钮少一处对不齐的机会）。
    personas: list[Persona]
    successCriteria: list[SuccessCriterion]
    nodes: list[SpecNode]
    pages: list[SpecPage]
    #: 精修时**本轮指令点名要改的模型段**（只在 refine 模式下有意义，其余时候 None）。
    #:
    #: ⚠ 2026-08-16 那天「改一句话把整个应用换掉」修了四次都只保住结构：
    #:   `workflow`/`rbac` 这些跟指令毫不相干的段照样被整段重写（逐段指纹 0/6）。
    #:   根因是 spec-first 天生「从 spec 树重新生成」，出口永远是完整模型——
    #:   没有任何地方说得出「这一段用户根本没提，别动它」。这个字段就是那句话。
    #:
    #: 语义是**声明，不是执行**：它只说指令碰了哪几段，真正的沿用发生在
    #: spec_first_pipeline 的汇合出口（apply_refine_segment_reuse）。放在 SPEC 步
    #: 是因为那一步本来就在读指令原文，顺带声明不多花一次 LLM 调用。
    #:
    #: None 与 [] 语义不同，别混：None = 模型没声明（老 spec、非精修、或它没答），
    #: 按"不知道"处理，一段都不敢沿用；[] = 模型明确说"一段都没碰"，全部沿用。
    refineScope: list[str] | None = None
    #: 起草这一份时**替用户定了**的事（伴随式澄清，2026-08-27 加）。
    #:
    #: 跟 refineScope 同一个模子：**声明，不是执行**。它不改变 spec 本身，
    #: 也不拦任何一步；只是让"我替你定了什么"这件事从静默变成看得见。
    #: 真正的消费在 spec_first_pipeline 的假设出口（assumption sink）→ SSE →
    #: 前端非阻塞面板 → 用户改哪条就进中途排队。
    #:
    #: ⚠ 校验**故意宽松**（整个字段可缺、可空）。它属于增强类，
    #:   一份好 spec 不许因为附带的假设写歪了就整轮失败（本仓第七条）。
    #:   脏数据在 _sanitize_assumptions 里进模型**之前**就被剥掉了。
    assumptions: list[SpecAssumption] | None = None

    @field_validator("appName")
    @classmethod
    def app_name_is_a_name(cls, v: str) -> str:
        name = (v or "").strip()
        if not name:
            raise ValueError("appName 不能为空——壳上要挂它")
        if name in _GENERIC_APP_NAMES:
            raise ValueError(
                f"appName「{name}」是品类不是名字，换一个这个产品自己的名字"
            )
        if is_host_brand_name(name):
            raise ValueError(
                f"appName「{name}」是生成方的名字，换一个这个产品自己的名字"
            )
        if len(name) > 20:
            raise ValueError(f"appName「{name[:20]}…」太长了，侧栏挂不下，控制在 20 字以内")
        return name

    @model_validator(mode="after")
    def personas_usable(self) -> "SpecTree":
        if not self.personas:
            raise ValueError("personas 不能为空——壳上的登录身份要从它来")
        ids = [p.id for p in self.personas]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"persona id 重复：{dupes}")
        return self

    # ── 下面每一条都能真失败。被替换那份的闸校验的是自己刚拼出来的形状，
    #    恒过；那不叫闸，叫留痕。 ────────────────────────────────────

    @model_validator(mode="after")
    def ids_unique(self) -> "SpecTree":
        for label, ids in (
            ("成功判据", [c.id for c in self.successCriteria]),
            ("节点", [n.id for n in self.nodes]),
            ("页面", [p.id for p in self.pages]),
        ):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            if dupes:
                raise ValueError(f"{label} id 重复：{dupes}")
        return self

    @model_validator(mode="after")
    def tree_is_a_tree(self) -> "SpecTree":
        """根存在、父引用解析得开、没有环。

        成环这一条不是假想：节点是模型现编的 id，它完全可能把两个节点互设
        父子。真成了环，下游任何按树遍历的代码都会挂死，而且是**静默**挂死
        （无限循环不报错），比结构不对更难查。
        """
        by_id = {n.id: n for n in self.nodes}
        if self.rootNodeId not in by_id:
            raise ValueError(f"rootNodeId '{self.rootNodeId}' 不在 nodes 里")
        if by_id[self.rootNodeId].parentId is not None:
            raise ValueError(f"根节点 '{self.rootNodeId}' 的 parentId 必须是 null")
        for n in self.nodes:
            if n.id == self.rootNodeId:
                continue
            if not n.parentId:
                raise ValueError(f"非根节点 '{n.id}' 没有 parentId")
            if n.parentId not in by_id:
                raise ValueError(f"节点 '{n.id}' 的 parentId '{n.parentId}' 不存在")
        for n in self.nodes:
            seen, cur = {n.id}, n.parentId
            while cur:
                if cur in seen:
                    raise ValueError(f"节点 '{n.id}' 往上走成环了：{sorted(seen)}")
                seen.add(cur)
                cur = by_id[cur].parentId
        return self

    @model_validator(mode="after")
    def refs_resolve(self) -> "SpecTree":
        crit_ids = {c.id for c in self.successCriteria}
        ev_ids = {n.id for n in self.nodes if n.type == "evidence"}
        node_ids = {n.id for n in self.nodes}
        for n in self.nodes:
            for ref in n.coversCriteria:
                if ref not in crit_ids:
                    raise ValueError(
                        f"节点 '{n.id}' 的 coversCriteria 指向不存在的判据 '{ref}'，"
                        f"真实判据是：{sorted(crit_ids)}"
                    )
            for ref in n.evidenceRefs:
                if ref not in node_ids:
                    raise ValueError(f"节点 '{n.id}' 的 evidenceRefs 指向不存在的节点 '{ref}'")
                if ref not in ev_ids:
                    raise ValueError(
                        f"节点 '{n.id}' 的 evidenceRefs 指向 '{ref}'，"
                        f"但那不是 evidence 节点"
                    )
        return self

    @model_validator(mode="after")
    def every_criterion_is_covered(self) -> "SpecTree":
        """**没有孤儿判据。**

        这是整份契约里最核心的一条，也是它跟一堆漂亮文字的分界线：写下一条
        「销售可在 2 分钟内完成新客户创建」，就必须有一个 requirement 认领它。
        判据没人认领 = 说了要做但没安排做，那份 spec 就只是文案。
        """
        covered = {c for n in self.nodes if n.type == "requirement" for c in n.coversCriteria}
        orphans = [c.id for c in self.successCriteria if c.id not in covered]
        if orphans:
            raise ValueError(
                f"这些成功判据没有任何 requirement 认领：{orphans}——"
                f"判据没人认领等于说了要做但没安排做"
            )
        return self

    @model_validator(mode="after")
    def pages_are_usable(self, info: ValidationInfo) -> "SpecTree":
        """页面清单要能被第 3 步真的拿去逐页出图。

        `coversNodes` 只准指 requirement / design：task 是工程活儿、evidence 是
        依据，两者都画不出界面。指错了下游会拿着一条「定义客户数据模型」去让
        生图模型画一个页面，画出来必然是废的。

        ## 精修轮的冻结页豁免（2026-08-18 真机）

        步伴 AI 拐杖那轮：精修指令只加一列，LLM 照抄沿用页 'family_monitor'
        时漏了 coversNodes，重问 2 次仍漏 → 整条 spec-first 被判失败回落
        老链路 → 全量重抽。用户看到的是「发了一句精修，整个应用重画」——
        被这条校验拦下的恰恰是**上一轮已经验证过承载关系的页**。

        另一半原因是结构性的：spec 节点 id（n0/n1…）每轮重铸，不在 id 冻结
        词表里。沿用页就算带着上一版的 coversNodes 回来，指向的也是上一版的
        节点命名空间——本轮多半悬空。要求 LLM 跨命名空间重连一个「内容没变」
        的页，是把必然出错的活儿派给它。

        所以：validation context 里带 frozenPageIds（精修轮的上一版页面 id）
        时，这些页的 coversNodes **允许为空**（语义=「沿用页，承载关系见
        上一版」）；给了引用仍逐条查真。**新页（不在冻结清单里）一个字不放宽**
        ——它没有上一版可依，说不清承载什么就是真说不清。非精修轮无 context，
        行为逐字不变。
        """
        frozen: set = set((info.context or {}).get("frozenPageIds") or set())
        if not self.pages:
            raise ValueError("pages 不能为空——第 3 步要按页逐张出图，没有页就没有下游")
        ok_types = {n.id: n.type for n in self.nodes if n.type in ("requirement", "design")}
        for p in self.pages:
            if not p.coversNodes:
                if p.id in frozen:
                    continue  # 沿用页：承载关系上一轮验证过，本轮缺声明不拦
                raise ValueError(f"页面 '{p.id}' 没有 coversNodes——说不清它承载哪条需求")
            for ref in p.coversNodes:
                if ref not in ok_types:
                    raise ValueError(
                        f"页面 '{p.id}' 的 coversNodes 指向 '{ref}'，"
                        f"它不是 requirement / design 节点（task 和 evidence 画不出界面）"
                    )
        return self


from .spec_llm_call import call_spec_json

def validate_spec_tree(
    payload: Any, *, frozen_page_ids: Optional[set] = None
) -> dict[str, Any]:
    """独立的闸：给一份 spec（dict 或已解析的模型），返回 {passed, findings}。

    跟 v5_model_gate.validate_five_system_model 同一个口径——二元、机械、
    fail-closed，findings 说人话。给不是本模块生成的 spec（比如人手写的、
    或将来从别处导入的）也能过一遍同一把尺子。

    `frozen_page_ids`：精修轮的上一版页面 id。这些页 coversNodes 允许为空
    （豁免理由见 pages_are_usable 的 docstring）。缺省 None = 不豁免，
    非精修调用方行为逐字不变。
    """
    if isinstance(payload, SpecTree):
        return {"passed": True, "findings": []}
    try:
        SpecTree.model_validate(
            payload, context={"frozenPageIds": frozen_page_ids or set()}
        )
    except ValidationError as exc:
        findings = []
        for err in exc.errors():
            loc = ".".join(str(x) for x in err.get("loc", ())) or "spec"
            msg = str(err.get("msg", "")).replace("Value error, ", "")
            findings.append({"path": loc, "message": msg})
        return {"passed": False, "findings": findings}
    except Exception as exc:  # noqa: BLE001 — 形状完全不对（不是 dict 之类）
        return {"passed": False, "findings": [{"path": "spec", "message": str(exc)[:200]}]}
    return {"passed": True, "findings": []}


def spec_to_markdown(spec: SpecTree) -> str:
    """渲染成 artifact 的正文。

    形状要满足既有的 `_STRUCTURE_DECOMPOSE_CONTRACT`（earsSections=["requirement"]、
    minContentChars=800）——那份契约本来就在，只是从前被 f-string 轻松糊弄过去。
    现在 EARS 那一条由真实的 acceptance 满足，字数由真实内容满足。
    """
    by_parent: dict[Optional[str], list[SpecNode]] = {}
    for n in spec.nodes:
        by_parent.setdefault(n.parentId, []).append(n)

    lines = [f"# SPEC Tree：{spec.appName}", ""]
    lines.append("## 使用者 (personas)")
    for i, p in enumerate(spec.personas):
        默认 = "（界面默认登录身份）" if i == 0 else ""
        lines.append(f"- {p.id} {p.name}{默认}" + (f"：{'；'.join(p.goals)}" if p.goals else ""))
    lines.append("")
    lines.append("## 成功判据 (success criteria)")
    for c in spec.successCriteria:
        lines.append(f"- id:{c.id} {c.text}")
    lines.append("")

    lines.append("## 需求 (requirement)")
    for n in spec.nodes:
        if n.type != "requirement":
            continue
        covers = "、".join(n.coversCriteria) or "—"
        lines.append(f"### {n.id} {n.title}")
        lines.append(f"- 验收：{n.acceptance}")
        lines.append(f"- 覆盖判据：{covers}")
        if n.evidenceRefs:
            lines.append(f"- 依据：{'、'.join(n.evidenceRefs)}")
    lines.append("")

    lines.append("## 设计 (design)")
    for n in spec.nodes:
        if n.type == "design":
            lines.append(f"### {n.id} {n.title}")
            lines.append(f"- {n.notes}")
    lines.append("")

    lines.append("## 任务 (tasks)")
    for n in spec.nodes:
        if n.type == "task":
            lines.append(f"- {n.id} {n.title} ｜ 验证：{n.verify}")
    lines.append("")

    lines.append("## 页面清单 (pages)")
    for p in spec.pages:
        lines.append(f"### {p.id} {p.name}")
        lines.append(f"- 给谁用：{p.audience}")
        lines.append(f"- 要干什么：{p.purpose}")
        lines.append(f"- 承载节点：{'、'.join(p.coversNodes)}")
    lines.append("")

    lines.append("## 依据 (evidence)")
    for n in spec.nodes:
        if n.type == "evidence":
            lines.append(f"- {n.id} {n.title}（source:{n.source}）")
    lines.append("")
    del by_parent  # 树形缩进留给将来；当前消费方要的是分段，不是缩进
    return "\n".join(lines)


_SYSTEM = (
    "你是把产品意图整理成可验收规格的架构师。只输出一个 JSON 对象，"
    "不要解释、不要 markdown 围栏。"
)


#: 作曲家点了「应用」之后必须进这一步（2026-08-20 真机）。
#: 此前 device 只传到第 3 步画页：壳换成顶栏+底栏，但 SPEC 仍按 PC 后台切页
#: （「左侧大表 + 右侧新建」），风格段还在点名「主表几列 / 右侧详情栏」。
#: 用户看到的就是带底栏的宽屏工作台——画布对了、信息架构没换。
#: 这一段只在 device=phone 时进 user 消息；桌面提示词一字不改。
#: 对照 ant-design-mobile TabBar 官方 demo（src/components/tab-bar/demos）：
#: title 是「首页 / 待办 / 消息 / 我的」，不是站点地图「某某列表页」。
#: name 会原样打进底栏，带「页」就会在 390px 折成三行（2026-08-20 芸编智管）。
_PHONE_SPEC_IA = """设备：手机 App（竖屏）。不是 PC 后台。

切页硬要求：
- 一屏一件主任务。列表和新建/编辑/详情必须拆成不同页，purpose 不许写成「左侧大表 + 右侧表单」这种宽屏工作台。
- 入口是底部 3~5 个标签，不是左侧菜单。
- pages.name 就是底栏 Tab 上那几个字（对照 antd-mobile TabBar.Item title：首页、待办、消息、我的）：2～4 个汉字，不要带「页」，不要产品名前缀。不要写成「古籍列表页」——那是站点地图，不是 Tab 标签。页内大标题写在 purpose 里。
- 列表用单列卡片或行（标题 + 状态 + 日期），不要 6 列以上的宽表，不要左右分栏。
- 每页 purpose 写成手机上一眼能看完的动作，例如「上滑看随访任务，点一条进详情」。
- pages 数组第一项必须是这个产品的主工作列表（打开 App 第一眼看见的那页）。我的/设置若有，必须排在标签栏最后，且不能当首页。
- 不要把某一页画成「个人资料 + 设置入口 + 退出登录」——那是个人中心的偷懒模板，不是这个产品。
- 页面本身就是手机 App，不要在页面里再套一层手机外框或把整页收成居中卡片。"""


#: 平板 IA。2026-08-30 夜真机：dropdown 选了平板、goal / pages_json /
#: generated-app 都盖了 tablet 章，五页 HTML 仍是桌面 <aside class="w-64">
#: + 1920 工作台。根因跟 08-20 手机那次同类——只改了 stamp，没改 SPEC 树。
#: 壳仍走桌面统一路径（aside+header+main），密度按 1112 不是 1920。
#: 数字抄账本 viewportCss / ant-design Layout.Sider（w-52 ≈ 208px），
#: 不自己发明；grok ScreenMode 的纪律是「一个枚举、一处引导」，不是抄 TUI。
_TABLET_SPEC_IA = """设备：平板现场作业（横屏 1112×834 CSS 像素）。不是 1920 PC 中台，也不是竖屏手机 App。

切页硬要求：
- 导航保留 <aside> 侧栏（page_shell 桌面统一路径认 aside；不要改成手机底栏）。
  宽度用 Tailwind w-52（约 208px，对照 ant-design Layout.Sider / ProLayout siderWidth），
  不要桌面展开态的宽侧栏（16rem）。
- 顶栏短：标题 + 最多一个主操作。不要一长条工具栏。
- 工作区两栏（主列 + 可折叠旁路详情），不要三栏、不要「主表几列 + 右侧详情栏永久占着」。
- 表格最多 5 列；更多字段进旁路详情。不要桌面那种 8 列宽表。
- 筛选用顶部 chip，不要左侧筛选面板。
- 图表一屏最多两张并排，不要四宫格 dashboard。
- 视口按 1112×834（iPad Air 横屏 CSS px，见 product_archetypes.json tablet.viewportCss）排。
- 不要手机底栏 TabBar，不要 <nav data-testid="phone-tabbar">。
"""


#: 消费 / 内容应用 IA。2026-08-31：壳换成顶栏横栏不够——SPEC 仍按后台
#: 切页（看板/台账 + 侧栏）时，第 3 步只能把中台塞进无 aside 的壳。
#: 对照 Medium / Apple News 的顶栏 + 大图，不是 ant-design Layout.Sider。
#: 选择通道是范围卡 productArchetype，不许按话题词分流。
_CONTENT_SPEC_IA = """产品原型：消费 / 内容应用（封面、图流、杂志、天气一瞥）。不是业务后台。

切页硬要求：
- 导航是顶部一条横栏，放在 <header> 里的 <nav>。不要左侧 <aside> 侧栏。
- 图是一等公民：封面/图流页第一眼必须有大幅配图，不要用 KPI 统计卡顶替画面。
- 页型是封面、图流、详情、杂志，不是看板/工作台/台账。
- appName 和 personas 挂在每一页的顶栏上。
- 不要宽表、不要右侧详情栏、不要四张等宽统计卡当首页。
- 桌面铺满视口，不要 max-w-5xl 收成落地页卡片。
- pages.name 是读者看见的短名（今日、封面、图流），不要带「管理」「台账」。
"""


#: 自由类型 IA。2026-08-31：用户要在空态加「自由类型」。业务原型会把
#: 团子画成中台，内容原型又硬切成封面/图流/详情/杂志四页——图流绑洞
#: 收成一张，首屏半空。自由类型不套任何一套页型清单，按这道题自己切。
_FREE_SPEC_IA = """产品原型：自由类型。不要默认后台中台，也不要默认杂志封面。

切页硬要求：
- 导航是顶部一条横栏，放在 <header> 里的 <nav>。不要为了凑后台硬加左侧 <aside>。
- 按这道题自己的活儿切页：有的页是图流、有的页是表单、有的页是封面都可以。
  不要为了凑后台硬切成看板/工作台/台账，也不要为了凑杂志硬切成封面/图流/详情/杂志四页。
- 图流、封面架、货架第一屏必须有至少 4 张可见配图，不要两列网格只放一张。
  封面/长文可以一张主图。
- 不要四张等宽 KPI 统计卡当首页，不要宽表台账除非这道题就是台账。
- appName 和 personas 挂在每一页的顶栏上。
- 桌面铺满视口，不要 max-w-5xl 收成落地页卡片。
- pages.name 是使用者看见的短名，不要带「管理」除非这道题就是后台。
"""


#: 桌面骨架先验的 IA 硬要求。手机路径禁止进 prompt——跟 `_PHONE_SPEC_IA`
#: 并排放是 2026-08-20「壳是手机、内容是 PC」的再现：种子全是 workbench /
#: kanban 宽屏页型，escape hatch 说的是「题装不进骨架」，不是「形态是手机」。
_SKELETON_IA_HARD = (
    "硬要求：先按这套页清单展开结构，再按本道题收窄（改名、增删页、改 purpose "
    "都可以，但不要抛开骨架自己另起一套信息架构，除非这道题明显装不进去）。"
    "页面 id 可以按本产品重起。不要把骨架里的页型/区块当成绑定或实体。"
)


def _format_skeleton_prior(skeleton: Optional[dict], *, device: str = "desktop") -> str:
    """把骨架压成先验段。绑定不进这段。

    ⚠ 2026-08-27：`app_template.match_app_template` 此前对工厂是死的（契约、
    种子、单测都在，生产调用点为零）。先验只回答「这个行业的应用长什么样」，
    实体 / 字段 / 绑定每次按本题生成。骨架一旦带绑定，整段丢（fail-open）——
    混进去会被结构闸当悬挂引用咬，正是旧模板库的病。

    ⚠ 2026-08-20 / 2026-08-27：device 只传到画页时 SPEC 仍按 PC 切页，壳是
    手机、内容是 PC。求自觉已经失败过。骨架种子全是桌面 workbench/kanban，
    跟 `_PHONE_SPEC_IA`「一屏一件主任务」是两套硬要求。不许把「不要抛开骨架」
    和「切页硬要求」一起丢给模型让它选。手机只留用途 / 角色形态当软提示，
    页型、区块槽、`_SKELETON_IA_HARD` 整段不进。

    工厂路径是 `run_spec_first`。`capability_maps.execute_structure` 也调
    `generate_spec_tree`，那是旧能力图的结构步，不是工厂主轴；不在那里偷偷
    喂骨架——装错插座是本仓付过三次账的形态。`generate_spec_tree` 没有流式
    孪生；drive-full 与 drive-full-stream 都进同一条 `run_spec_first`。
    """
    if not isinstance(skeleton, dict):
        return ""
    from .app_template import _assert_no_bindings

    problems: list[str] = []
    _assert_no_bindings(skeleton, "skeleton", problems)
    if problems:
        print(f"[spec_tree] 骨架带绑定，丢弃先验（fail-open）：{problems[0]}")
        return ""
    pages = skeleton.get("pages")
    if not isinstance(pages, list) or not pages:
        return ""

    lines: list[str] = []
    name = str(skeleton.get("name") or "").strip()
    industry = str(skeleton.get("industry") or "").strip()
    when = str(skeleton.get("when") or "").strip()
    title = " / ".join(part for part in (name, industry) if part)
    roles = [str(r).strip() for r in (skeleton.get("roleShape") or []) if str(r or "").strip()]
    purposes = [
        str(page.get("purpose") or "").strip()
        for page in pages
        if isinstance(page, dict) and str(page.get("purpose") or "").strip()
    ]

    if device == "phone":
        # 机械和解，不求模型自觉：手机 IA 是硬的，骨架只剩业务用途。
        lines.append(
            "行业骨架提示（业务用途，不是信息架构；切页服从下面的手机约束，"
            "不要按桌面页型或区块槽展开）："
        )
        if title:
            lines.append(f"骨架：{title}")
        if when:
            lines.append(f"适用：{when}")
        if roles:
            lines.append("角色形态：" + "、".join(roles))
        if purposes:
            lines.append("这些页在做的事（用途提示，页型与切页按手机重做）：")
            lines.extend(f"- {purpose}" for purpose in purposes)
        return "\n".join(lines)

    heading = "行业骨架先验（结构建议，不是成品；绑定/实体/字段不在这里，也不许从这里发明绑定）"
    lines.append(f"{heading}：")
    if title:
        lines.append(f"骨架：{title}")
    if when:
        lines.append(f"适用：{when}")
    if roles:
        lines.append("角色形态：" + "、".join(roles))
    workflow = skeleton.get("workflowShape")
    if isinstance(workflow, dict):
        bits: list[str] = []
        steps = workflow.get("steps")
        if isinstance(steps, int) and steps >= 1:
            bits.append(f"{steps} 步")
        if workflow.get("hasApproval"):
            bits.append("含审批")
        phases = [str(p).strip() for p in (workflow.get("phases") or []) if str(p or "").strip()]
        if phases:
            bits.append("阶段：" + "、".join(phases))
        if bits:
            lines.append("流程形态：" + "，".join(bits))
    lines.append("建议页面（页清单 + 区块槽）：")
    for page in pages:
        if not isinstance(page, dict):
            continue
        pid = str(page.get("id") or "").strip() or "?"
        kind = str(page.get("kind") or "").strip()
        purpose = str(page.get("purpose") or "").strip()
        slot_bits: list[str] = []
        for block in page.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            btype = str(block.get("type") or "").strip()
            region = str(block.get("region") or "").strip()
            if not btype:
                continue
            slot_bits.append(f"{btype}@{region}" if region else btype)
        slot = f"  区块：{'、'.join(slot_bits)}" if slot_bits else ""
        lines.append(f"- {pid}  {kind}  {purpose}{slot}".rstrip())
    lines.append(_SKELETON_IA_HARD)
    return "\n".join(lines)


#: 让 SPEC 步顺带把「我替用户定了什么」说出来（伴随式澄清，2026-08-27）。
#:
#: ⚠ 为什么挂在这一次调用上，而不是另起一次 LLM 去"找找有什么该问的"：
#:   替用户做决定的**就是这一步**。让做决定的人当场说出他定了什么，
#:   跟事后让另一个模型去猜"刚才那份 spec 里哪些是拍的"，可靠性差一个量级，
#:   而且后者还要多花一次调用、多等十几秒——这一步本来就要 60~90 秒。
#:   同样的判断在 refineScope 上已经做过一次（见 SpecTree.refineScope 头注）。
#:
#: ⚠ 措辞盯的是「**改了产品会长得不一样**」，不是「不确定」。第一版写的是
#:   「凡是你不确定的都列出来」，模型会老老实实列出配色、字号、分页条数——
#:   那些下游自己会定，摆到用户面前只是噪音。
_ASSUMPTIONS_ASK = """最后，请在 JSON 顶层再加一个 assumptions 字段：

{
  "assumptions": [
    {"id": "a1",
     "topic": "员工怎么登录",
     "decision": "手机号 + 短信验证码",
     "alternatives": ["工号 + 密码", "企业微信扫码"],
     "why": "需求里没说员工身份从哪来，按最通用的做法定的"}
  ]
}

它记的是：**这句需求没说、而你必须定下来才画得下去、并且换一个定法这个产品
就会长得不一样**的事。判断标准就一条——「改成另一个选项，界面/流程/角色要跟着改吗」：

- 算：登录与身份从哪来、角色怎么划分、核心流程有几步（审批一级还是两级）、
  关键数据什么时候变（库存下单扣还是发货扣）、钱和权限的口径。
- 不算：配色、字号、分页每页几条、按钮文案、图标选哪个。这些下游自己会定，
  列出来只是噪音。
- 也不算：需求里**已经说清楚**的事。用户说了「给护士用」就不要再假设使用者是谁。

alternatives 写这个行业里**真的会有人选**的另一两种做法，不要为了凑数编。
最多 3 条，宁可少写。一条都没有（需求足够清楚，你没替谁定过什么）就给 []。

⚠ 这不是在问问题，也不会打断你——你该怎么定还怎么定，spec 照常写完整。
   这个字段只是把你已经做的决定如实说出来。"""


def build_spec_prompt(
    goal: str,
    *,
    clarified: str = "",
    evidence: str = "",
    refine: Optional[dict] = None,
    prev_pages: Optional[list] = None,
    device: str = "desktop",
    skeleton: Optional[dict] = None,
    product_archetype: str = "",
) -> list[dict[str, str]]:
    """装配 spec 生成的对话。

    输入刻意**不是原始那一句话**，而是第 1 步的产物（澄清后的需求 + 外部证据）。
    直接吃原句等于把「从一句话发明」原样往前挪一格，什么也没改善。

    skeleton（2026-08-27 加）：`match_app_template` 命中的应用骨架，作为
    **页清单 / 区块槽先验**。不传则提示词**逐字不变**。精修轮由调用方决定
    不传——上一版结构已经在 refine 段里，骨架再压上去会打架。
    device=phone 时先验降成用途 / 角色软提示，不进页型硬要求——跟
    `_PHONE_SPEC_IA` 并排「不要抛开骨架」会把 2026-08-20 那次（壳是手机、
    内容是 PC）再演一遍。
    device=tablet 时骨架仍走桌面页清单（aside 壳），另挂 `_TABLET_SPEC_IA`
    收密度——2026-08-30 夜只盖 stamp 不改 IA，五页全是 w-64。

    ## refine（2026-08-14 晚加）：增量迭代不是从零造

    `refine = {"instruction": 本轮追加要求, "modelDigest": 上一版模型摘要}`。
    在场时把两样都摊进 prompt，并下连续性硬要求。此前 spec-first 第二轮
    只拿冻结的原始 goal 重抽——用户的追加指令和上一版结构全被丢掉，
    「迭代」实际是「按原话重抽一次」（E29 精修只喂了老链路，没喂这条）。
    口径照开源里同型做法（GPT-Engineer improve 模式 / Aider）：
    旧产物 + 增量指令 + 「没被波及的保持稳定」约束，整体重生成。

    ## prev_pages（2026-08-17 晚加）：页面 id 冻结的硬词表块

    `[{"id","name"}]`，上一版模型里的页面清单（spec_first_pipeline.
    model_id_lexicon 的 pages 档）。只在精修轮传；不传则提示词**逐字不变**。

    ⚠ 上面"连续性硬要求"那句对 id 是**求自觉**，真机实测求不动：第二轮
      页面 id 从 `p1..p4` 整套重铸成 `elder_management` 等，与 HTML 侧的键
      交集为空。这里换成跟第 4/5 步 build_prev_ids_block 同一个模子——
      名单 + 照抄要求 + 以名字为锚。page 曾是唯一 id 保住 5/5 的段，靠的
      正是 html_structure 提示词里那句「sourcePageId 照抄」；SPEC 步此前
      没有这句，所以漂的恰恰是它铸的 id。
    """
    parts = [f"产品意图：\n{goal.strip()}"]
    # 产品宪章：opt-in 关着时 charter_prompt_block() 是空串，parts 跟从前
    # 逐字节一致（test_refine缺席时_prompt与从前逐字一致）。删这一行，
    # test_product_charter_opt_in 的活路径判据必须红。
    # ⚠ 三块都取自叶子 turn_context，不取自 product_charter / v5_llm_generate：
    #   那两个都在**被这条链调用**的一侧，反过来 import 就成环（见叶子模块头）。
    from services.turn_context import (
        approved_plan_prompt_block,
        charter_prompt_block,
        clarification_prompt_block,
        connector_prompt_block,
    )

    plan = approved_plan_prompt_block()
    if plan:
        parts.append(plan)
    charter = charter_prompt_block()
    if charter:
        parts.append(charter)
    connectors = connector_prompt_block()
    if connectors:
        parts.append(connectors)
    # 开工前用户答过的澄清（硬约束）。⚠ 2026-08-29 之前这一块**只接在老生成器
    # `_build_user_content` 上**，而 spec-first 成功时根本不跑它——于是卡片答完、
    # 缺口关掉、闸变绿，生成侧一个字都没看到。它自己的注释写着「少了它，前面问得
    # 再漂亮也只是让用户多点了几下」，描述的正是它当时的处境。
    clarified_block = clarification_prompt_block()
    if clarified_block:
        parts.append(clarified_block)
    if clarified.strip():
        parts.append(f"澄清与假设（第 1 步产物）：\n{clarified.strip()}")
    if evidence.strip():
        parts.append(f"外部证据（第 1 步检索到的）：\n{evidence.strip()}")
    skeleton_block = _format_skeleton_prior(skeleton, device=device)
    if skeleton_block:
        parts.append(skeleton_block)
    if refine and (str(refine.get("instruction") or "").strip()):
        digest = str(refine.get("modelDigest") or "").strip()
        if digest:
            parts.append(f"既有应用结构（上一版，本轮在它基础上迭代）：\n{digest[:4000]}")
        parts.append(
            "本轮迭代要求（增量修改，不是重做）：\n"
            f"{str(refine['instruction']).strip()[:2000]}\n\n"
            "连续性硬要求：没被迭代要求波及的页面/角色/判据必须保留，"
            "名字与 id 与上一版保持一致；被要求改动的地方如实改。"
            "不许因为重新生成就把整个应用换一套设计。"
        )
        # ★ 让 SPEC 步顺带声明「这条指令碰了哪几段」（2026-08-17）。
        #
        # 上面那条"连续性硬要求"是**求它自觉**，实测四组基线逐段指纹 0/6——
        # 求不动。这里把它从措辞升级成一个结构化字段：模型说没碰的段，
        # 汇合出口会**直接从上一版复制**，它写什么都盖不掉。
        #
        # ⚠ 只列可沿用的三段。datamodel / page / appbundle 故意不在选项里：
        #   前两者跟第 3 步刚生成的 HTML 是绑定关系（data-field 指字段、
        #   bind_pages 按 page 打孔），appbundle 整段都是指向本轮产物的引用
        #   （landingPageRef / pageBindings）。三者沿用上一版都必然错位，
        #   给了选项模型迟早会选，不如根本不给。
        #   ⚠ 这份清单必须跟 spec_first_pipeline.REFINE_REUSABLE_SEGMENTS 一致——
        #     一边给选项另一边不认，是本仓典型的"只改一半"，且完全静默。
        #     由 tests/test_refine_segment_reuse.py 的同名判据钉住。
        if prev_pages:
            # ★ 页面 id 冻结（2026-08-17）。判断锚是**名字/用途**，不是位置——
            #   同 html_structure.build_prev_ids_block 的理由：顺序会变，名字不会。
            listing = "\n".join(
                f"    {p.get('id')}  ←→  {p.get('name')}"
                for p in prev_pages
                if isinstance(p, dict) and p.get("id")
            )
            # ⚠ 2026-08-18 过夜：这段提示词照常出现，模型照样加后缀/改名。
            #   真正拨回在 spec_first_pipeline 第 2 步出口（page_id_freeze），
            #   这里继续喂词表是为了少漂一次，不指望它自觉。
            parts.append(
                "上一版已有这些页面（id ←→ 名字）：\n\n"
                f"{listing}\n\n"
                "页面 id 冻结（硬要求）：本轮页面清单里，凡是跟上面**说的是同一页**的"
                "（以名字和用途判断，不看顺序），id 和 name 都**照抄**，一个字符都"
                "不许改。只有本轮真正新增的页面才起新 id；被迭代要求删掉的页面"
                "直接不出现。不许把「改这一页的内容」做成「换一个 id 的新页」——"
                "id 一换，这一页的历史就断了。"
                "照抄上一版页面时，coversNodes 也要重新给：指向你**本轮 nodes**"
                "里它承载的需求节点，不要照抄上一版的节点 id（那些 id 本轮不存在）。"
            )
        parts.append(
            "另外，请在 JSON 顶层加一个 refineScope 字段：一个字符串数组，"
            "列出**本轮迭代要求真正涉及**的模型段，可选值只有这三个："
            '"rbac"（角色与权限）、"workflow"（流程节点与流转）、'
            '"aigc"（AI 能力与编排）。\n'
            "判断标准是「这条要求不改这一段就做不到吗」——只改某页的展示内容、"
            "加模拟数据、调文案措辞，这三样都**不涉及**上述任何一段，"
            "此时给空数组 []。宁可少列，不要顺手多列：列进来的段会被重新生成，"
            "没列的段原样沿用上一版。"
        )

    parts.append(
        """请产出这个产品的规格树，JSON 形状严格如下，key 名一字不差：

{
  "rootNodeId": "n0",
  "version": 3,
  "appName": "给这个产品起的名字（2~20 字，是名字不是品类——「维保云」行，「管理系统」不行）",
  "personas": [
    {"id": "u1", "name": "角色名（如「维修主管」，不是某个人的名字）",
     "goals": ["这个角色打开系统主要要干什么"]}
  ],
  "successCriteria": [
    {"id": "sc1", "text": "可验收的一句话，要能判定做到没做到（含数量/时间这类硬指标更好）"}
  ],
  "nodes": [
    {"id": "n0", "parentId": null, "type": "requirement",
     "title": "需求标题",
     "acceptance": "当<某个角色做某事>时，系统应<给出什么结果>。",
     "coversCriteria": ["sc1"], "evidenceRefs": ["nE1"]},
    {"id": "n4", "parentId": "n0", "type": "design",
     "title": "设计标题", "notes": "这一块怎么做", "evidenceRefs": ["nE1"]},
    {"id": "n7", "parentId": "n4", "type": "task",
     "title": "任务标题", "verify": "怎么验证它做完了"},
    {"id": "nE1", "parentId": "n0", "type": "evidence",
     "title": "依据标题", "source": "user_input:<原话> 或 clarification:<哪一条>"}
  ],
  "pages": [
    {"id": "p1", "name": "页面名", "audience": "谁用这一页",
     "purpose": "打开这一页第一眼看见什么（列表/看板/一张详情，不是点开之后的表单）",
     "coversNodes": ["n0", "n4"]}
  ]
}

硬性要求（不满足会被机械校验拦下来，然后把错误原文喂回给你重做）：

1. **每一条 successCriteria 都必须至少被一个 requirement 的 coversCriteria 认领。**
   判据没人认领等于说了要做但没安排做。
2. requirement 的 acceptance 必须写成「当……时，系统应……」这种句式，
   而且要具体到能判定真假；design 必须有 notes，task 必须有 verify，
   evidence 必须有 source。
3. parentId 必须指向真实存在的节点，只有 rootNodeId 那一个是 null，不许成环。
4. evidenceRefs 只能指向 type 为 evidence 的节点。
5. pages 至少一页，coversNodes 只能指 requirement 或 design
   （task 是工程活儿、evidence 是依据，都画不出界面）。
6. pages 是**粗粒度**的：说清楚有哪几页、每页给谁用、打开时看见什么就够了，
   不要写字段名、组件名、接口名——那些由下游根据界面反推，不归你定。
7. **appName 和 personas 会被挂到每一页的侧栏上**，所以它们必须是这个产品的
   一套、而不是每页各来一套。appName 要是个真名字（「维保云」「智维工单」），
   单独一个「系统」「平台」「管理系统」会被拦下来。也不许写成「面团」
   「面团AI」「SlideRule」——那是生成方的名字。personas 至少一条，
   排在第一位的那个是界面上默认的登录身份。
8. purpose 写的是**打开这一页时的静息态**。列表页就写「看账号列表、筛状态」，
   不要写成「列表 + 新增表单 + 分配角色」——下游会把后半段画进首屏，抽屉关不掉。
   「新增 / 编辑」是从本页出发的按钮，不是这一页第一眼的主界面。
   桌面也不许把一页写成「左侧列表 + 右侧新建表单」；新建要么另起一页，要么只是按钮。

规模按这个产品**真实的复杂度**来，不要凑数也不要偷懒：
判据 3~6 条，requirement 3~8 个，页面 3~8 页是常见区间。"""
    )
    from services.archetype_legal import is_content_app, is_free_app

    content = is_content_app(product_archetype)
    free = is_free_app(product_archetype)
    if device == "phone":
        # 桌面规则第 7 条仍写「侧栏」——手机壳挂的是顶栏。只改这一处，
        # 整段 JSON 形状里的花括号不能进 f-string。
        parts[-1] = parts[-1].replace("每一页的侧栏上", "每一页的顶栏上")
        parts[-1] = parts[-1].replace(
            '"name": "页面名"',
            '"name": "列表（底栏短名，2~4字，不要带页）"',
        )
        parts.append(_PHONE_SPEC_IA)
        if content:
            parts.append(
                "图是一等公民：列表/封面用大图卡片，不要指标卡顶替画面。"
            )
        elif free:
            parts.append(
                "按这一页的活儿切：图流至少 4 张可见图，表单就一个主表单。"
                "不要为了凑后台硬加指标卡。"
            )
    elif content:
        parts[-1] = parts[-1].replace("每一页的侧栏上", "每一页的顶栏上")
        parts.append(_CONTENT_SPEC_IA)
    elif free:
        parts[-1] = parts[-1].replace("每一页的侧栏上", "每一页的顶栏上")
        parts.append(_FREE_SPEC_IA)
    elif device == "tablet":
        # ⚠ 2026-08-30 夜：授予已接通，SPEC 仍按桌面切页。
        # 平板走桌面骨架（aside+header+main），**不要**改「侧栏→顶栏」——
        # 那一针是手机壳挂顶栏用的。改了 page_shell 桌面统一路径就抠不到 aside。
        # 也不许写成 `phone else desktop`：tablet 会静默领走 1920 工作台 IA。
        parts.append(_TABLET_SPEC_IA)
    # ⚠ 伴随式澄清这一段**必须挂在最后**，不能跟着 JSON 形状那块一起 append。
    #   上面手机分支改的是 `parts[-1]`——一个**按位置**认人的写法。第一版把这
    #   段接在 JSON 块后面，`parts[-1]` 当场变成了它，于是「每一页的侧栏上 →
    #   顶栏上」和页面短名那两针**全打在这段假设说明上**，手机 SPEC 提示词
    #   静静地退回桌面措辞：不报错、不告警，只有 test_spec_tree 的两条设备判据
    #   会红。（本仓第一条：动手之前先确认哪条链真的在跑，位置也是一种链。）
    parts.append(_ASSUMPTIONS_ASK)
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def _sanitize_assumptions(payload: Any) -> None:
    """把 assumptions 洗干净（原地改），洗不出东西就整个键删掉。

    ⚠ **在校验之前**跑，这是它存在的全部理由。assumptions 属于增强类
      （本仓第七条）：一份 pages / nodes / 判据全对的 spec，不许因为顺带
      报出来的假设少写了一个 decision 就整轮失败、白烧 90 秒重问。
      让 SpecAssumption 保持严格 + 在这里先剥脏行，比把模型字段放宽好——
      放宽等于允许空壳假设一路流到用户面前（「我替你定了：」后面什么都没有）。

    ⚠ 不重问。模型把 assumptions 写歪了就当它没写，别为一个附带字段
      去转 reask——那一转是整份 spec 重来。
    """
    if not isinstance(payload, dict):
        return
    raw = payload.get("assumptions")
    if raw is None:
        return
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, row in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(row, dict):
            continue
        topic = str(row.get("topic") or "").strip()
        decision = str(row.get("decision") or "").strip()
        if not topic or not decision:
            continue
        # 同一个 topic 报两遍 = 同一件事说两次，面板上是两张一样的卡
        key = topic.lower()
        if key in seen:
            continue
        seen.add(key)
        # ⚠ 必须先判 list。模型把 alternatives 写成一个字符串（"工号或扫码"）
        #   是真会发生的，而字符串**是可迭代的**——不判就逐字符拆成
        #   ["工","号","或","扫","码"] 摆到用户面前，一个字一个选项。
        #   判据 test_脏假设不许把一份好spec拖去重问 当场咬到了这一口。
        #
        # ⚠ 2026-08-27 审查补：上一版判完 list 就**丢掉**裸字符串那一支
        #   （`if isinstance(raw_alts, list) else []`），于是模型给的那条备选
        #   静静没了——卡退化成一句"知会一声"，用户想改都没得点。
        #   改抄 grok-build `serde_lenient.rs` 的口径：裸字符串/数字 →
        #   **单元素列表**，不是空列表。逐字符那口仍然堵着（str 不是 list，
        #   走的是单元素分支）。认不出的形状（bool/dict/嵌套数组）返回 None，
        #   这里按"没写"处理——增强类不许因此把整份 spec 拖去重问。
        alts_raw = lenient_string_list(row.get("alternatives")) or []
        alts = [str(a).strip()[:60] for a in alts_raw if str(a).strip()]
        # 「另一种做法」跟已定的那个一模一样 = 点了等于没改
        alts = [a for a in alts if a != decision][:4]
        cleaned.append(
            {
                "id": str(row.get("id") or "").strip() or f"a{i + 1}",
                "topic": topic[:40],
                "decision": decision[:120],
                "alternatives": alts,
                "why": str(row.get("why") or "").strip()[:160],
            }
        )
        if len(cleaned) >= 3:
            break
    if cleaned:
        payload["assumptions"] = cleaned
    else:
        payload.pop("assumptions", None)


def _sanitize_phone_page_names(payload: Any) -> None:
    """手机 spec 的 pages.name 就是 Tab 短名。模型仍爱写成「某某页」，出口机械剥。

    不重问：跟 page_shell.nav_tab_label 同一把刀，求自觉已经失败过。
    """
    if not isinstance(payload, dict):
        return
    from services.page_naming import nav_tab_label

    app = str(payload.get("appName") or "").strip()
    for page in payload.get("pages") or []:
        if not isinstance(page, dict):
            continue
        raw = str(page.get("name") or "").strip()
        if not raw:
            continue
        # 这是**手机**页名清洗（函数名就写着 phone）：底栏短名，剥「页」。
        # 桌面不走这条——标准答案见 page_naming.nav_tab_label 头注。
        page["name"] = nav_tab_label(raw, app, strip_page_suffix=True)


def _prune_stale_covers_on_frozen_pages(payload: Any, frozen_ids: set) -> None:
    """精修轮：把冻结页 coversNodes 里的跨轮悬空引用剪掉（原地改，只动冻结页）。

    spec 节点 id 每轮重铸（不在 id 冻结词表里），沿用页照抄上一版时带回来的
    coversNodes 指向的是**上一版的节点命名空间**——本轮多半悬空。这不是模型
    在编东西，是两轮命名空间对不上，属于机械可判可修的形状：引用真实存在的
    留下，悬空的剪掉；剪空了由冻结页豁免接住（见 pages_are_usable）。
    **新页一条不剪**——新页的悬空引用是真错误，照旧喂回重问。
    """
    if not isinstance(payload, dict):
        return
    ok_ids = {
        str(n.get("id"))
        for n in (payload.get("nodes") or [])
        if isinstance(n, dict) and n.get("type") in ("requirement", "design")
    }
    for p in payload.get("pages") or []:
        if not isinstance(p, dict) or str(p.get("id")) not in frozen_ids:
            continue
        covers = p.get("coversNodes")
        if not isinstance(covers, list):
            continue
        kept = [c for c in covers if str(c) in ok_ids]
        dropped = [str(c) for c in covers if str(c) not in ok_ids]
        if dropped:
            print(
                f"[spec_tree] 精修沿用页 '{p.get('id')}' 的 coversNodes 剪掉跨轮悬空引用："
                f"{'、'.join(dropped[:6])}（上一版节点命名空间，本轮不存在）"
            )
            p["coversNodes"] = kept


class SpecGenerationError(RuntimeError):
    """生成失败。**故意不提供占位兜底**——那正是被替换的那份的病。"""


def generate_spec_tree(
    goal: str,
    *,
    clarified: str = "",
    evidence: str = "",
    refine: Optional[dict] = None,
    prev_pages: Optional[list] = None,
    device: str = "desktop",
    skeleton: Optional[dict] = None,
    product_archetype: str = "",
    llm_json_fn: Optional[Any] = None,
    max_reask: int = 2,
) -> SpecTree:
    """生成并校验一份 spec，失败就抛。

    `llm_json_fn(messages) -> dict|None` 可注入，测试用假 LLM 时不依赖网络。

    reask 用的是「把校验器的原话喂回去」——跟 freeform_block 和
    structured_llm_json 同一套路子。这里额外把 Pydantic 的报错**翻译成中文
    人话**再喂：实测那些 `Value error, ` 前缀和 `loc` 元组喂回去，模型会去
    猜路径是什么意思，不如直接说「哪个节点的哪个字段、为什么不行」。

    ⚠ 失败**不回落占位**。被替换的那份最大的问题不是写得糙，是它**永远成功**——
    一份恒定 1 需求 1 风险 1 交付物的假树，看起来跟真的一样，还能过自己的闸。
    宁可如实报失败，也不要再造一个看着像那么回事的空壳。
    """
    messages = build_spec_prompt(
        goal,
        clarified=clarified,
        evidence=evidence,
        refine=refine,
        prev_pages=prev_pages,
        device=device,
        skeleton=skeleton,
        product_archetype=product_archetype,
    )
    last_err = "未调用"
    # 精修轮的冻结页 id：coversNodes 校验对它们放宽（豁免理由与真机事故见
    # pages_are_usable）。只有 refine 在场才算冻结——首轮传 prev_pages 是不存在的。
    frozen_ids: set = (
        {str(p.get("id")) for p in prev_pages if isinstance(p, dict) and p.get("id")}
        if (refine and prev_pages)
        else set()
    )

    for attempt in range(max_reask + 1):
        outcome = call_spec_json(messages, llm_json_fn, stage="specfirst.spec")
        payload = outcome.payload
        if payload is None:
            last_err = outcome.failure or "LLM 没有返回可解析的 JSON"
            # 传输/配额层挂了：没拿到东西、没有可喂回去的内容，而且下层
            # call_llm_with_retry 已经退避重试过了。再转两圈是纯浪费。
            if outcome.transport:
                break
        else:
            _sanitize_assumptions(payload)
            if device == "phone":
                _sanitize_phone_page_names(payload)
            if frozen_ids:
                _prune_stale_covers_on_frozen_pages(payload, frozen_ids)
            verdict = validate_spec_tree(payload, frozen_page_ids=frozen_ids)
            if verdict["passed"]:
                return SpecTree.model_validate(
                    payload, context={"frozenPageIds": frozen_ids}
                )
            last_err = "；".join(
                f"{f['path']}：{f['message']}" for f in verdict["findings"][:6]
            )
        if attempt == max_reask:
            break
        messages = messages + [
            {"role": "assistant", "content": json.dumps(payload or {}, ensure_ascii=False)[:4000]},
            {
                "role": "user",
                "content": (
                    f"上面这份没通过机械校验，问题是：\n{last_err}\n\n"
                    "只改错的地方，其余保持原样，重新输出完整 JSON。"
                ),
            },
        ]

    raise SpecGenerationError(f"spec 生成失败（重问 {max_reask} 次后）：{last_err}")


