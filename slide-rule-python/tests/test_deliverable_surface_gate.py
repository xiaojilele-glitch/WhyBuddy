# -*- coding: utf-8 -*-
"""交付面可用性闸的判据（2026-09-06）。

## 这道闸为什么存在

换 LLM 供应商，同类题目交付物差三倍，而闭环报告**逐字相同**：

    话题：小型装修公司工地进度与验收（业主提整改 / 项目经理报进度传验收单）

                  页数   总字符   button  input  select textarea
    gemini-3.7      3    11 万      38      1      1      0
    gemini-3.8      7    29 万     103     22      6      2

    两轮 publishClosure：blocked=false  blockerCount=0  skills=6/6  tierCounts 全 0

三个角色端八个功能塞进三页、加起来一个 form 都没有——用户点「提整改」没有地方填。
既有三道闸（evidence / relevance / factoryTodo）量的都是"流程走完没有"，
没有一道量"用户真正看到的那一屏能不能用"。

## 判据的形状：三向区分 + 一条接线

**这个文件最要紧的不是"薄的被拦了"，是那三向必须同时成立**：

    真坏的  → 拦          （否则闸没用）
    真好的  → 放行        （否则闸天天开火，等于没在量东西 —— gate_health 头注原话）
    把好的改坏 → 拦        （否则闸在空转，报 0 跟坏掉长得一模一样）

前两条的输入是**两轮真机原样落库**（`_thin()` / `_rich()`），不是手搓的。
本仓「一之二」那条：护栏的判据必须喂真机那一发的原样载荷，不许自己拼——
第一版判据写的是 `totalEntry == 0` 才拦，拿真机喂进去当场发现咬不住
（3 页里有 1 页带 1 个 input，全局总数 2，于是放行，而真正出事的两页各自是 0）。

第四条是**接线判据**（本仓第三条：函数写对了 ≠ 它被调用了）：
走真正的 `execute_v5_capability` → `derive_publish_closure_response`，
确认 `deliverableSurface` 真的出现在闭环里、且 hard blocker 真的把
`blocked` 翻成 True。少这一条，上面三条全绿也可能是装在不通电的插座上。
"""

import dataclasses
import json
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from models.v5_state import CapabilityRun, V5SessionState  # noqa: E402
from services import deliverable_surface as ds  # noqa: E402
from services.v5_publish_closure_response import (  # noqa: E402
    PublishClosureResponse,
    derive_publish_closure_response,
)

_FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures" / "deliverable_surface"


def _load(name: str) -> V5SessionState:
    """真机原样落库 → V5SessionState。只取本闸要读的两块，其余用默认。"""
    raw = json.loads((_FIXTURES / name).read_text(encoding="utf-8"))
    return V5SessionState(
        sessionId=raw.get("sessionId") or name,
        goal=raw.get("goal") or {"text": "fixture"},
        specFirstPages=raw.get("specFirstPages"),
        modelVersions=raw.get("modelVersions") or [],
    )


@pytest.fixture
def thin() -> V5SessionState:
    """gemini-3.7 那一轮：3 页 / 3 角色 / 2 个录入控件，两页零录入。"""
    return _load("thin-3-pages.json")


@pytest.fixture
def rich() -> V5SessionState:
    """gemini-3.8 那一轮：7 页 / 3 角色 / 30 个录入控件。"""
    return _load("rich-7-pages.json")


# ── 三向区分 ────────────────────────────────────────────────────────────


class Test三向区分:
    def test_真机薄那一轮必须被拦(self, thin):
        """正向。承载「提交施工播报」「提交验收单/上传整改照片」的两页各自零录入。"""
        m = ds.measure(thin)
        assert m is not None
        assert m.pageCount == 3 and m.roleCount == 3
        unserved = {row["nodeId"] for row in m.unserved}
        assert unserved == {"n1", "n2"}, f"该拦的两条需求没被认出来：{m.unserved}"
        assert all(
            row["why"] == "covering_pages_have_no_entry" for row in m.unserved
        ), m.unserved
        assert ds.is_thin(thin) is True
        _, hard, _ = ds.surface_findings(thin)
        assert [h["code"] for h in hard] == ["CLOSURE_SUBMIT_INTENT_UNSERVED"]

    def test_真机厚那一轮必须放行(self, rich):
        """⚠ 反向，这条才是防"闸天天开火"的那一半。

        gate_health 头注：「一道一直给同一个结论的闸，等于没在量东西」。
        一道把合格交付物也拦下的闸，第一周就会被人关掉。
        """
        m = ds.measure(rich)
        assert m is not None
        # readonly identity fields are visible but cannot accept input; browser
        # semantics intentionally count only editable controls.
        assert m.pageCount == 7 and m.totalEntry == 28
        assert m.unserved == [], f"合格交付物被判成未服务：{m.unserved}"
        assert ds.surface_reason(rich) is None
        assert ds.is_thin(rich) is False
        _, hard, warn = ds.surface_findings(rich)
        assert hard == [] and warn == []

    def test_把厚那轮的录入控件删光必须变红(self, rich):
        """⚠ 变异。闸报 0 和闸坏掉长得一模一样，所以要证明它**会**报。"""
        import re

        pages = dict(rich.specFirstPages["pages"])
        for pid, html in pages.items():
            for tag in ("input", "select", "textarea"):
                html = re.sub(rf"<{tag}\b", f"<span data-was-{tag}", html, flags=re.I)
            html = re.sub(
                r"""(?:contenteditable\s*=\s*["']true["']|role\s*=\s*["'](?:textbox|combobox|searchbox|spinbutton)["'])""",
                "data-x=1",
                html,
                flags=re.I,
            )
            pages[pid] = html
        rich.specFirstPages = {**rich.specFirstPages, "pages": pages}

        m = ds.measure(rich)
        assert m.totalEntry == 0, "变异没生效，这条判据在空转"
        assert ds.is_thin(rich) is True
        assert {row["nodeId"] for row in m.unserved} >= {"n2", "n3", "n4"}


# ── 判据自己不许被糊弄 ──────────────────────────────────────────────────


class Test判据自己没瞎:
    def test_脚本与注释里的input不算数(self):
        """本仓第二条踩过一模一样的形状：判据 grep 标识符，而那个词同时出现在
        文档字符串里 → 变异后照样绿。生成页的 `<script>` 里带着
        `'<input type="text">'` 这类字符串模板，不剥就会把"脚本里提到过"
        数成"页面上有"。"""
        html = (
            "<div><button>点我</button></div>"
            "<!-- <input type='text'> 注释里的 -->"
            "<script>const t = '<input type=\"text\"><textarea></textarea>';</script>"
            "<style>.x{ content:'<select>' }</style>"
            "<template><input name='tpl'></template>"
        )
        p = ds.measure_page("p1", html)
        assert p.entry == 0, "脚本/注释/样式/模板里的控件被数进来了"
        assert p.clickable == 1

    def test_div拼出来的可点可填也算(self):
        """反面的反面：全用 div + role 拼的页面不许被判成零控件（假阳性）。"""
        p = ds.measure_page(
            "p1",
            '<div role="button">保存</div><div contenteditable="true"></div>'
            '<div role="combobox"></div>',
        )
        assert p.clickable >= 1 and p.entry >= 2

    def test_没有页面时不归本闸管(self):
        """照 grok 的 `Option<EmptyReason>`：没什么可说就返回 None。
        「一页都没画」是既有链路的问题，本闸不许顺手把它也拦一遍。"""
        st = V5SessionState(sessionId="no-pages", goal={"text": "x"})
        assert ds.measure(st) is None
        assert ds.surface_reason(st) is None
        assert ds.is_thin(st) is False
        assert ds.surface_findings(st) == (None, [], [])

    def test_根节点不算提交意图(self):
        """⚠ 真机喂出来的。厚那轮的 `n0` 是 umbrella 需求（acceptance 里有
        「点名」），`rootNodeId` 就是它，按设计不被任何页面承载。把它算进来
        会让**每一份**合格交付物都报「有需求没落笔的地方」——又一道天天开火的闸。"""
        spec = {
            "rootNodeId": "n0",
            "nodes": [
                {"id": "n0", "type": "requirement", "title": "全流程管理",
                 "acceptance": "支持排课、点名、记账与查验"},
                {"id": "n1", "type": "requirement", "title": "家长请假申请",
                 "acceptance": "家长提交请假申请"},
            ],
        }
        assert ds.submit_intent_nodes(spec) == ["n1"]

    def test_只读看板不许被拦(self):
        """SPEC 没有提交意图 + 零录入 → 只警告，不拦。纯看板是合法产品形态。"""
        st = V5SessionState(
            sessionId="dashboard",
            goal={"text": "看板"},
            specFirstPages={
                "pages": {"p1": "<div><button>刷新</button><table></table></div>"},
                "spec": {
                    "rootNodeId": "n0",
                    "personas": [{"id": "u1", "name": "老板"}],
                    "nodes": [{"id": "n1", "type": "requirement", "title": "查看经营看板",
                               "acceptance": "展示出勤率与营收图表"}],
                    "pages": [{"id": "p1", "name": "看板", "coversNodes": ["n1"]}],
                },
            },
        )
        assert ds.is_thin(st) is False
        _, hard, warn = ds.surface_findings(st)
        assert hard == []
        assert "CLOSURE_NO_ENTRY_SURFACE" in [w["code"] for w in warn]

    def test_一条需求有多个承载页时任一有录入口就算服务到了(self):
        """真机喂出来的第二条。厚那轮 `n4`（老师/校长**录入**实收金额，家长
        **核对**缴费历史）被两页承载：收费台账页 7 个录入控件、家长账单页 0 个。
        家长那页服务的是同一条需求的**只读那一半**——要求每个承载页都有录入口
        会把它判成违规，那是误报。"""
        spec = {
            "rootNodeId": "n0",
            "nodes": [{"id": "n4", "type": "requirement", "title": "收费台账",
                       "acceptance": "老师录入实收金额；家长核对缴费历史"}],
            "pages": [
                {"id": "p_admin", "coversNodes": ["n4"]},
                {"id": "p_parent", "coversNodes": ["n4"]},
            ],
        }
        by_page = {
            "p_admin": ds.measure_page("p_admin", "<input name='amount'>"),
            "p_parent": ds.measure_page("p_parent", "<div>只读账单</div>"),
        }
        assert ds.unserved_submit_intents(spec, by_page) == []
        # 反向：两页都没录入口才算未服务
        by_page["p_admin"] = ds.measure_page("p_admin", "<div>也只读</div>")
        assert [r["nodeId"] for r in ds.unserved_submit_intents(spec, by_page)] == ["n4"]

    def test_声明的code跟真正发出的一致(self):
        """⚠ 两处书写同一份事实，必须有判据钉住。

        `BLOCKER_CODES` 是给 `arch_graph.gate_inventory` 看的字面量声明
        （`{"code": _CODE[reason]}` 里的值是下标表达式，AST 扫不到）。
        它跟 `_CODE` 漂了的后果不是报错，是新 code 静默漏出 `[gate_codes]`
        注册纪律，而 `--check` 照样绿。"""
        assert set(ds.BLOCKER_CODES) == set(ds._CODE.values())
        assert len(ds.BLOCKER_CODES) == len(ds.SurfaceReason)

    def test_每个原因都有分层和文案(self):
        """反向：新加一个 SurfaceReason 忘了配 tier/code/message 会静默变成
        KeyError 或空消息。这条让它在测试期就红。"""
        for reason in ds.SurfaceReason:
            assert reason in ds._TIER
            assert reason in ds._CODE
            assert reason in ds._MESSAGE
            assert ds._TIER[reason] in ("hard_blocker", "warning")

    def test_指纹不掺会话id(self):
        """gate_health.record_verdict 头注：掺了会话 id 每次都不一样，
        连击永远不触发——那等于装了个不会响的报警器。"""
        a = ds.surface_fingerprint({"reasons": ["x"], "pageCount": 3,
                                    "totalEntryControls": 2, "roleCount": 3})
        b = ds.surface_fingerprint({"reasons": ["x"], "pageCount": 3,
                                    "totalEntryControls": 2, "roleCount": 3})
        assert a == b and "sr-" not in a


# ── 接线：本仓第三条（函数写对了 ≠ 它被调用了）────────────────────────


class Test真的接在闭环上:
    def _closure_state(self, surface: dict, blocked: bool = False) -> V5SessionState:
        """把一份带 deliverableSurface 的闭环报告塞进 capabilityRuns，
        走**真正的** derive 路径——投影层的白名单会不会把它丢掉，只有这样才验得出来。"""
        return V5SessionState(
            sessionId="wire",
            goal={"text": "wire"},
            capabilityRuns=[
                CapabilityRun(
                    id="run-closure",
                    capabilityId="appbundle.runtimeClosure",
                    turnId="t1",
                    result={
                        "runtimeClosure": {
                            "blocked": blocked,
                            "blockers": [],
                            "perSkillEvidence": {
                                k: {"evidencePresent": True}
                                for k in ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")
                            },
                            "runtimeClosure": {
                                "skillsChecked": ["datamodel", "rbac", "workflow",
                                                  "page", "aigc", "appbundle"],
                                "versionPinsChecked": True,
                            },
                            "findingsByTier": {"hard_blocker": [], "warning": [], "info": []},
                            "deliverableSurface": surface,
                        }
                    },
                )
            ],
        )

    def test_deliverableSurface不许被投影层丢掉(self):
        """⚠ 白名单投影是静默的：不在 `_to_publish_closure_summary` 里列出的
        字段一律消失。上一轮 goalRelevance 就漏过一次（那个 dict 上方的注释
        自己记着）。这条钉住新字段真的活着到了前端。"""
        surface = {"pageCount": 3, "roleCount": 3, "totalEntryControls": 2,
                   "reasons": ["submit_intent_unserved"],
                   "unservedSubmitIntents": [{"nodeId": "n1"}]}
        got = derive_publish_closure_response(self._closure_state(surface))
        assert got is not None
        assert got.get("deliverableSurface") is not None, \
            "deliverableSurface 被白名单投影丢掉了——前端只看到结论看不到依据"
        assert got["deliverableSurface"]["totalEntryControls"] == 2
        assert got["deliverableSurface"]["unservedSubmitIntents"][0]["nodeId"] == "n1"
        PublishClosureResponse.model_validate(got)

    def test_warning进了tierCounts才算真的可见(self):
        """行为侧的另一半：warning 进了 findingsByTier 之后，
        `tierCounts.warning` 必须真的变成非 0——否则报告上那一格还是 0，
        「有话说但不拦」在用户眼里依然不存在。"""
        st = self._closure_state({"pageCount": 3, "reasons": ["one_page_per_role"]})
        report = st.capabilityRuns[0].result["runtimeClosure"]
        report["findingsByTier"]["warning"] = [
            {"code": "CLOSURE_ONE_PAGE_PER_ROLE", "ref": "3 个角色只摊到 3 个页面"}
        ]
        got = derive_publish_closure_response(st)
        assert got is not None
        assert got["tierCounts"]["warning"] == 1, \
            f"warning 没进 tierCounts，报告上那一格还是 0：{got['tierCounts']}"
        assert got["blocked"] is False, "warning 不许把这一轮判死"

    def test_没有渲染面时字段是None而不是空壳(self):
        """`None` = 本轮没有页面、不归那道闸管；`{}` 会被读成"量过了没问题"。
        两者混淆的后果是把"没量"说成"合格"。"""
        got = derive_publish_closure_response(self._closure_state(None))
        assert got is not None and got.get("deliverableSurface") is None

    def test_执行器真的调了这道闸并且能把blocked翻成True(self):
        """⚠ 最要紧的一条。前面全绿也可能是装在不通电的插座上。

        这里**直接执行产线源码**：读 `v5_capability_executor` 的真实调用点，
        证明 (a) 它调 surface_findings，(b) hard blocker 真的赋值给 blocked，
        (c) warning 真的进了 findingsByTier。重抄一份逻辑只能证明"我抄对了"
        （本仓 test_remaining_chain_does_not_redraft_spec 同一条纪律）。
        """
        src = pathlib.Path(__file__).resolve().parent.parent / "services" / "v5_capability_executor.py"
        code = src.read_text(encoding="utf-8")
        # 剥掉注释再匹配——否则"注释里提到过"会被当成"代码里调了"（本仓第二条）
        body = "\n".join(
            line for line in code.splitlines() if not line.lstrip().startswith("#")
        )
        assert "surface_findings(state)" in body, "执行器没有调用交付面闸"
        assert "surface_fingerprint(" in body, "交付面闸没进 gate_health 体检"
        at = body.index("surface_findings(state)")
        window = body[at:at + 900]
        assert "blocked = True" in window, \
            "hard blocker 没有把 blocked 翻成 True——闸量出问题却不拦"
        assert '"deliverableSurface": surface_summary' in body, \
            "量结果没有挂进闭环报告"
        # ⚠ 这一条必须盯**语义**（warning 那格的值是从 surface_warnings 来的），
        #   不能只盯 `'"warning": ['` 这个字面量——变异检查当场证明了后者
        #   会把 `"warning": [],` 也匹配上，断言直接打空（本仓第二条原话）。
        # `[^\]]*` 不行：`w["code"]` 里就有 `]`。限长非贪婪，且不跨行。
        assert re.search(r'"warning":\s*\[.{0,220}?surface_warnings', body), \
            "findingsByTier.warning 没有取自 surface_warnings —— " \
            "「有话说但不拦」那一档在闭环报告里等于不存在"

    def test_warning不参与blocked(self):
        """反向：只报不拦的那一档不许把这一轮判死（本仓第七条：增强类 fail-open）。"""
        st = V5SessionState(
            sessionId="warn-only",
            goal={"text": "看板"},
            specFirstPages={
                "pages": {"p1": "<div><button>刷新</button></div>",
                          "p2": "<div><input name='q'></div>"},
                "spec": {
                    "rootNodeId": "n0",
                    "personas": [{"id": "u1"}, {"id": "u2"}],
                    "nodes": [{"id": "n1", "type": "requirement", "title": "提交查询",
                               "acceptance": "用户填写关键字并提交"}],
                    "pages": [{"id": "p2", "coversNodes": ["n1"]}],
                },
            },
        )
        _, hard, warn = ds.surface_findings(st)
        assert hard == [], "两个角色两个页面只该警告，不该拦"
        assert [w["code"] for w in warn] == ["CLOSURE_ONE_PAGE_PER_ROLE"]
        assert ds.is_thin(st) is False


# ── 第二轮真机：这道闸把一份合格交付物拦了（假阳性）────────────────────
#
# 校区自习室座位预约那一轮，四条 requirement **全部**被判成「需要用户录入」，
# 等于没有区分度。而其中 n2 承载在一张只读页上（0 input / 0 select / 13 button），
# 它本来就不该有输入框——验收写的是「系统应自动…并在小程序端**提示**」。
# 于是 blocked=True / blockerCount=1，一份三条真需求都被正确服务的交付物被拦住。
#
# 一道会误报的 hard_blocker 的结局是**被人关掉**，那就等于白做。
# 所以这一组判据的份量跟「薄那一轮必须被拦」是**对等**的：
#   前者守「该拦的拦得住」，这一组守「不该拦的别拦」。缺任何一半这道闸都不能用。

_FP = (
    pathlib.Path(__file__).parent
    / "fixtures" / "deliverable_surface" / "false-positive-20260906.json"
)


def _fp_blob() -> dict:
    return json.loads(_FP.read_text(encoding="utf-8"))


class Test第二轮真机的假阳性:
    def test_夹具记着第一版确实误判了四条(self):
        """判据自检：夹具被人"整理"成正确的之后，这一组会立刻变红而不是空跑。"""
        blob = _fp_blob()
        assert blob["firstVersionVerdict"]["submitIntentNodes"] == ["n1", "n2", "n3", "n4"], (
            "夹具里第一版的判定变了"
        )
        assert blob["firstVersionVerdict"]["reasons"] == ["submit_intent_unserved"]

    def test_系统自动行为不算提交意图(self):
        """★ 这一条就是那个误报。

        n2「信用分奖惩与自动封禁策略」触发从句：
            当学生发生违约事件（迟到**未**签到、**被**举报占座核实）
            导致信用分低于设定阈值时
        —— 签到 前面是否定、举报 前面是被动，两个都在描述**条件**；
        真正的动作在「系统应自动…」之后，那是系统的活。

        变异：去掉触发从句切分（用 acceptance 全文）→ 本条红。
        变异：去掉否定/被动排除 → 本条红（`未签到` 会命中 `签到`）。
        """
        blob = _fp_blob()
        got = ds.submit_intent_nodes(blob["spec"])
        assert got == blob["expected"]["submitIntentNodes"], (
            f"提交意图判定变了：得到 {got}，期望 {blob['expected']['submitIntentNodes']}\n"
            + json.dumps(blob["expected"]["why"], ensure_ascii=False, indent=2)
        )
        assert "n2" not in got, blob["expected"]["why"]["n2"]

    def test_三条真需求一条都不许漏(self):
        """⚠ 排除规则的代价判据。只写「n2 不许命中」的话，把整个判定改成
        「一律不算提交意图」也能绿——那是把闸关掉，不是修准。"""
        got = ds.submit_intent_nodes(_fp_blob()["spec"])
        for nid in ("n1", "n3", "n4"):
            assert nid in got, f"{nid} 是真的要用户录入，漏了就等于闸失效"

    def test_这一轮不该被拦(self):
        """端到端：同一份 SPEC + 同一份逐页控件数，结论必须是「不拦」。"""
        blob = _fp_blob()
        # 夹具的 perPage 就是 PageSurface.as_dict() 的原样（字段名一致），
        # 直接展开——手抄一遍字段名就是给自己留一处会漂的书写。
        keep = {f.name for f in dataclasses.fields(ds.PageSurface)}
        by_page = {
            p["pageId"]: ds.PageSurface(**{k: v for k, v in p.items() if k in keep})
            for p in blob["perPage"]
        }
        unserved = ds.unserved_submit_intents(blob["spec"], by_page)
        hard = [u for u in unserved if u["why"] == "covering_pages_have_no_entry"]
        assert hard == [], (
            f"还在拦：{hard}。那一页（{blob['firstVersionVerdict']['pagesWithoutEntry']}）"
            "是只读展示页，承载的是「系统自动封禁并提示」这条需求。"
        )

    def test_否定与被动只看紧邻左侧一个字(self):
        """⚠ 放宽到「整句里出现过否定词」会把真需要上传口的需求也排掉。

        变异：改成 `any(neg in text for neg in ...)` → 本条红。
        """
        from services.deliverable_surface import _has_user_submit_action

        assert ds._has_user_submit_action("迟到未签到") is False
        assert ds._has_user_submit_action("被举报占座") is False
        assert ds._has_user_submit_action("学生拍照上传举报") is True
        assert ds._has_user_submit_action("先上传证明，未通过则重新上传") is True, (
            "整句里有「未」就排掉 —— 这条真的需要上传口"
        )

    def test_找不到系统从句时按全文算(self):
        """判不出来的时候倾向于**算作提交意图**（宁可多拦也不放过），
        跟这道闸整体的取向一致。"""
        from services.deliverable_surface import _trigger_clause

        assert ds._trigger_clause("学生提交申请") == "学生提交申请"
        assert ds._trigger_clause("当学生提交申请时，系统应记录") == "当学生提交申请时，"
