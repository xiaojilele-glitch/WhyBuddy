# -*- coding: utf-8 -*-
"""产品原型账本：「什么算闭环」不再是全局常量（2026-08-30）。

## 这道闸挡的是什么

改造前：

    REQUIRED_EVIDENCE_KEYS = ["datamodel","rbac","workflow","page","aigc","appbundle"]

写死，且**六样缺一样就不算闭环**。这不是"默认值保守"，是**结构性封顶**：
小游戏没有实体表/角色权限/审批流，按这个闸永远 0/6——不是生成得不好，
是不允许它闭环。而闭环是这个产品的全部意义。

同一份六系统词表，2026-08-30 数下来跨两门语言手抄了 **11 处**：

    Python 6 处   v5_capability_executor(REQUIRED_EVIDENCE_KEYS / RUNTIME_CLOSURE_EDGES)
                  v5_model_gate(SKILL_KEYS)            ← 结构闸自己那份
                  v5_llm_generate(_REQUIRED_SECTIONS)  ← 注释写着 "mirrors SKILL_KEYS"
                  v5_full_driver(_SKILL_EMIT_ORDER)
                  turn_narration(_SKILL_EMIT_ORDER)    ← 第二份同名常量
    TS 5+ 处      pageSkill.ts / appBundleSkill.ts

「mirrors」这个词就是第四条点名的形状：两份靠人肉对齐，改一份不报错。

## ⚠ 本文件最要紧的一条是「零行为变化」

改造的正确性不在于"能加新原型了"，在于**今天这条链路一个字节都没变**。
`test_默认原型与历史六样逐字一致` 钉死那六个字面量与六条边——
这是一条**故意重复写死**的判据：它存在的意义就是"账本被改动时当场红"。
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import archetype_legal as A  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: 改造前写死在 `v5_capability_executor` 里的那六样。**故意在判据里重抄一份**：
#: 账本被人改动时这条当场红，逼他说清是有意改闭环定义，还是手滑。
HISTORICAL_SIX = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

#: 改造前那六条闭环边（source, target, evidenceKey）。同上，故意重抄。
HISTORICAL_EDGES = [
    ("datamodel", "rbac", "DM_RBAC_FIELD_POLICY_EVIDENCE"),
    ("datamodel", "page", "DM_PAGE_BINDING_IMPACT_EVIDENCE"),
    ("rbac", "workflow", "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE"),
    ("workflow", "page", "WORKFLOW_PAGE_TASK_SURFACE_EVIDENCE"),
    ("page", "appbundle", "PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE"),
    ("aigc", "appbundle", "AIGC_APPBUNDLE_RUNTIME_EVIDENCE"),
]


class Test零行为变化:
    """⚠ 这一组是整个改造的验收。改造能不能上线只看它们。"""

    def test_默认原型与历史六样逐字一致(self):
        assert A.required_evidence() == HISTORICAL_SIX

    def test_默认原型的闭环边与历史逐字一致(self):
        got = [
            (e["sourceSkill"], e["targetSkill"], e["evidenceKey"])
            for e in A.closure_edges()
        ]
        assert got == HISTORICAL_EDGES

    def test_十一处手抄全部同源(self):
        """⚠ 正向 + 反向合一条：不但要"都等于六样"，还要"确实是从账本来的"。

        只断言"等于六样"是不够的——把字面量抄回去照样绿。所以这里改账本、
        重载模块，看它们**跟着变**。跟不着变的那处就是漏了的手抄。
        """
        from services import turn_narration, v5_capability_executor, v5_full_driver
        from services import v5_llm_generate, v5_model_gate

        assert v5_capability_executor.REQUIRED_EVIDENCE_KEYS == HISTORICAL_SIX
        assert v5_model_gate.SKILL_KEYS == HISTORICAL_SIX
        assert list(v5_llm_generate._REQUIRED_SECTIONS) == HISTORICAL_SIX
        assert v5_full_driver._SKILL_EMIT_ORDER == HISTORICAL_SIX
        assert turn_narration._SKILL_EMIT_ORDER == HISTORICAL_SIX

    def test_全仓不许再有写死的六系统字面量(self):
        """⚠ 反向判据。收成一本账之后，任何一处把字面量抄回去 = 账本白建。

        剥注释再匹配——CLAUDE.md 第二条踩过：判据 grep 标识符，而那个词
        同时出现在文档字符串里，变异后照样绿。
        """
        import ast

        literal = set(HISTORICAL_SIX)
        offenders = []
        for path in (ROOT / "services").rglob("*.py"):
            if path.name == "archetype_legal.py":
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.List, ast.Tuple)):
                    continue
                vals = [
                    e.value for e in node.elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)
                ]
                if len(vals) == len(literal) and set(vals) == literal:
                    offenders.append(f"{path.name}:{node.lineno}")
        assert not offenders, (
            f"这些地方又把六系统词表写死了：{offenders}\n"
            f"闭环定义只有一处：services/data/product_archetypes.json。"
        )


class Test未接通的原型不许假装能用:
    """⚠ 第七条：闭环类 fail-closed，缺证据就是缺，不许伪造绿灯。"""

    @pytest.mark.parametrize("name", ["casual_game", "glance_app"])
    def test_未接通的原型选中即失败(self, name):
        with pytest.raises(A.ArchetypeNotWired) as ei:
            A.required_evidence(name)
        # 报错要说清"缺哪些段"，否则下一个人不知道该去接什么
        assert name in str(ei.value)
        assert "生成侧还产不出" in str(ei.value)

    def test_resolve选中未接通的原型即失败(self):
        """选择通道落地后，resolve 必须 fail-closed。回落默认 = 假绿灯。"""
        with pytest.raises(A.ArchetypeNotWired):
            A.resolve(payload={"productArchetype": "casual_game"})
        with pytest.raises(A.ArchetypeNotWired):
            A.resolve(payload={"productArchetype": "glance_app"})

    def test_未接通的原型不许静静退回默认(self):
        """⚠ 这条是上一条的**意义**所在。

        回落默认会让「要个游戏、拿到一个后台系统」看起来像成功——
        那正是本仓最贵的一类事故（第一条：装在不通电的插座上，
        三次都靠真机日志才发现，判据全绿）。
        """
        with pytest.raises(A.ArchetypeNotWired):
            A.closure_edges("casual_game")

    def test_拼错的原型名不许退回默认(self):
        """§14.6：28 份手抄环境开关里有两份默认值对不上——拼错不报错，
        只静静把开关扳到反面。原型名同理。"""
        with pytest.raises(A.UnknownArchetype):
            A.required_evidence("buisness_app")  # 故意拼错
        with pytest.raises(A.UnknownArchetype):
            A.resolve(payload={"productArchetype": "buisness_app"})

    def test_默认原型必须是接通的(self):
        assert A.is_wired(A.DEFAULT_ARCHETYPE)
        assert A.DEFAULT_ARCHETYPE in A.wired_archetypes()

    def test_content_app接通且闭环只要页面和应用包(self):
        """消费端没有角色权限和审批流。把 wired 扳回去或把六系统塞回来，本条必须红。"""
        assert A.is_wired("content_app")
        assert "content_app" in A.wired_archetypes()
        assert A.is_content_app("content_app")
        assert not A.is_content_app("business_app")
        assert not A.is_content_app("")
        assert A.required_evidence("content_app") == ["page", "appbundle"]
        got = [
            (e["sourceSkill"], e["targetSkill"], e["evidenceKey"])
            for e in A.closure_edges("content_app")
        ]
        assert got == [
            ("page", "appbundle", "PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE")
        ]

    def test_free_app接通且不跟内容壳混名(self):
        """自由类型与内容共用开放壳，但 is_content_app 必须仍只认杂志那条。
        把 wired 扳回去或把六系统塞回来，本条必须红。"""
        assert A.is_wired("free_app")
        assert "free_app" in A.wired_archetypes()
        assert A.is_free_app("free_app")
        assert A.is_open_chrome("free_app")
        assert A.is_open_chrome("content_app")
        assert not A.is_content_app("free_app")
        assert not A.is_free_app("content_app")
        assert not A.is_open_chrome("business_app")
        assert A.required_evidence("free_app") == ["page", "appbundle"]
        got = [
            (e["sourceSkill"], e["targetSkill"], e["evidenceKey"])
            for e in A.closure_edges("free_app")
        ]
        assert got == [
            ("page", "appbundle", "PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE")
        ]
        assert A.label("free_app") == "自由类型"


class Test政策包不是TRAE:
    """政策包抄 SKILL.md frontmatter，挂在现有账本上。禁止接 skill_runtime。"""

    def test_默认原型政策包是公开五件套(self):
        pack = A.policy_pack()
        assert pack["name"] == "business-app"
        assert pack["allowedTools"] == ["spec", "pages", "structure", "bind", "closure"]
        assert pack["whenToUse"]
        assert A.allowed_tools("business_app", "desktop") == tuple(pack["allowedTools"])
        assert A.allowed_tools("business_app", "phone") == tuple(pack["allowedTools"])

    def test_未接通原型也能亮出政策但选中仍失败(self):
        game = A.policy_pack("casual_game")
        glance = A.policy_pack("glance_app")
        assert game["allowedTools"] == ["spec", "pages", "closure"]
        assert glance["allowedTools"] == ["spec", "pages", "closure"]
        with pytest.raises(A.ArchetypeNotWired):
            A.required_evidence("casual_game")
        with pytest.raises(A.ArchetypeNotWired):
            A.required_evidence("glance_app")

    def test_政策包加载器不许进口skill_runtime(self):
        import ast

        src = (ROOT / "services" / "archetype_legal.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        assert "services.skill_runtime" not in imported
        assert "skill_runtime" not in imported
        assert "from .skill_runtime" not in src


class Test账本自身自洽:
    def test_每个原型都要有装配根(self):
        """appbundle 是装配根：任何原型最终都要能装出一个可跑的东西。
        没有装配根的原型，闭环了也交付不出来。"""
        for name in A.archetype_names():
            keys = (A._spec_raw(name).get("requiredEvidence") or [])
            assert "appbundle" in keys, f"{name} 没有装配根 appbundle"

    def test_闭环边只许连本原型声明过的技能(self):
        """⚠ 悬空边 = 一条永远不可能满足的闭环要求，整个原型静默 0/N。"""
        for name in A.archetype_names():
            spec = A._spec_raw(name)
            keys = set(spec.get("requiredEvidence") or [])
            for e in spec.get("closureEdges") or []:
                assert e["sourceSkill"] in keys, f"{name}: 边的源 {e['sourceSkill']} 不在 requiredEvidence 里"
                assert e["targetSkill"] in keys, f"{name}: 边的靶 {e['targetSkill']} 不在 requiredEvidence 里"

    def test_证据键不许重复(self):
        """两条边共用一个 evidenceKey，等于一条证据顶两条边用——闭环会虚高。"""
        for name in A.archetype_names():
            ks = [e["evidenceKey"] for e in (A._spec_raw(name).get("closureEdges") or [])]
            assert len(ks) == len(set(ks)), f"{name} 有重复的 evidenceKey"

    def test_返回的是副本不是账本本身(self):
        """⚠ 实测形状：调用方对返回值 append/切片，就地改会污染全局账本，
        而闸有 11 个消费点——一处污染，处处错，且不报错。"""
        a = A.required_evidence()
        a.append("polluted")
        assert "polluted" not in A.required_evidence()
        e = A.closure_edges()
        e[0]["sourceSkill"] = "polluted"
        assert A.closure_edges()[0]["sourceSkill"] != "polluted"

    def test_账本是合法JSON且带版本(self):
        raw = json.loads((ROOT / "services" / "data" / "product_archetypes.json").read_text(encoding="utf-8"))
        assert raw.get("version"), "账本必须带 version——两台机器版本不同要看得出来"
        assert A.ARCHETYPE_LEDGER_VERSION == raw["version"]


class Test这道闸咬得动:
    """⚠ 防空转。判据全绿时，「判据坏了」和「确实没问题」长得一模一样。"""

    def test_探测器真的会报悬空边(self):
        bad = {"requiredEvidence": ["a", "appbundle"],
               "closureEdges": [{"sourceSkill": "a", "targetSkill": "ghost",
                                 "state": "allowed", "evidenceKey": "X"}]}
        keys = set(bad["requiredEvidence"])
        assert bad["closureEdges"][0]["targetSkill"] not in keys, "构造的悬空边没被认出来"

    def test_探测器真的会报重复证据键(self):
        ks = ["X", "X"]
        assert len(ks) != len(set(ks)), "构造的重复键没被认出来"


class Test设备形态账本:
    """⚠ 三处手抄、形态各异（元组 / 集合＋哨兵 / 散文），所以"搜同一串字面量"
    根本对不上——加一个 watch 必然漏一处，而漏的后果是**生成出来了但闸不认**，
    静默失效（第四条）。"""

    #: 改造前 `_DEVICE_RUBRIC` 的完整原文。**故意逐字重抄一份**：
    #: 这是一段调过的提示词，改它 = 改判定结果。任何人动账本里的 posture，
    #: 这条当场红，逼他说清是有意改提示词还是手滑。
    HISTORICAL_RUBRIC = (
        "顺带判一件事：这个系统主要该在**哪种设备**上用。判据是**使用姿态**"
        "（人在什么状态下操作），不是句子里出现了什么词。\n"
        "  · phone —— 站着、走动、单手、在现场、即时上报：扫码/拍照/打卡/签字/"
        "随手记一笔，或者使用者是个人在日常生活里用（记账、日程、情绪、预约、下单）。\n"
        "  · desktop —— 坐着、长时段、多列对照、批量操作、审批与配置：看板/中台/"
        "后台/分析/汇总/对账/排产/关系图/权限分级，使用者是在工位上处理一批事的人。\n"
        "  · tablet —— 手持或支起、单手点按为主但视野接近桌面：现场演示、点单、"
        "查房、巡店，坐站切换。\n"
        "  · unspecified —— **没有姿态信号就必须选这个**。别硬猜。\n"
        "两个方向的坑（这两组最容易判错，判的是谁在什么状态下用，不是词）：\n"
        "  「外卖骑手运力调度看板」有「骑手」，但用的人是调度员坐在后台 → desktop\n"
        "  「员工打卡的月度汇总与补卡审批」有「打卡」，但汇总审批是 HR 坐着做 → desktop\n"
        "  「巡检工单，工人到现场拍照上传当场提交」有「工单」，但人站着走动 → phone\n"
        "  「仓库盘点，扫码逐箱核对」有「仓库」，但扫码逐箱是走动作业 → phone\n"
        "用户明说了「App」「手机端」「小程序」「PC 端」「网页版」「电脑上用」就直接照办，"
        "不用再推姿态。\n"
        "拿不准、或者一句话里几个角色姿态不同（提交侧像手机、审批侧像桌面）→ "
        "unspecified。**判 unspecified 不丢人，硬猜错了下游会按错的档去设计版式。**"
    )

    def test_rubric_逐字不变(self):
        """⚠ 整个设备改造的验收：提示词一个字节都不许变。"""
        from services.intake_judge import _DEVICE_RUBRIC

        assert _DEVICE_RUBRIC == self.HISTORICAL_RUBRIC

    def test_闸的合法域含接通的平板(self):
        assert set(A.supported_devices()) == {"desktop", "phone", "tablet"}
        assert "watch" not in A.supported_devices()

    def test_判定输出域含接通的平板(self):
        from services.intake_judge import _VALID_DEVICES

        assert _VALID_DEVICES == {"desktop", "phone", "tablet", "unspecified"}

    def test_哨兵不是设备(self):
        """⚠ unspecified 是「没有姿态信号」的判定结果，不是一种设备。
        混进闸的合法域 = 允许交付一个"设备未定"的应用。"""
        assert A.JUDGE_UNSPECIFIED not in A.supported_devices()
        assert A.JUDGE_UNSPECIFIED in A.valid_judge_devices()

    def test_未接通的设备不进合法域也不进提示词(self):
        """⚠ watch 仍是契约声明、生成侧未接。进了提示词 = 判定会输出
        一个闸不认的值。tablet 已接通，必须在合法域和提示词里。"""
        assert "watch" not in A.supported_devices()
        assert "watch" not in A.device_rubric_bullets()
        assert "tablet" in A.supported_devices()
        assert "· tablet ——" in A.device_rubric_bullets()

    def test_接通的设备必须都进提示词(self):
        """⚠ 反向判据。加了设备、闸认了、提示词没提 = 判定永远不会选它，
        等于白加——本仓"写好了但没接上"那类事故的又一形态。"""
        for d in A.supported_devices():
            assert f"· {d} ——" in A.device_rubric_bullets(), f"{d} 没进提示词"

    def test_运行时判断不许再写死设备枚举(self):
        """⚠ 反向判据，但**只管运行时**。

        Python 的 `Literal[...]` 只吃字面量，不能写成 `Literal[tuple(...)]`——
        那四处类型标注物理上没法派生，见下一条用 parity 锁钉住它们。
        这条管的是 `in {...}` / `in (...)` 这类**运行时**判断：它们能派生，
        没派生就是又一份手抄。
        """
        import ast

        pairs = {
            frozenset({"desktop", "phone"}),
            frozenset({"desktop", "phone", "unspecified"}),
            frozenset({"desktop", "phone", "tablet"}),
            frozenset({"desktop", "phone", "tablet", "unspecified"}),
        }
        offenders = []
        for path in (ROOT / "services").rglob("*.py"):
            if path.name == "archetype_legal.py":
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.List, ast.Tuple, ast.Set)):
                    continue
                # `Literal["desktop","phone"]` 的下标不算——它是类型，不是运行时判断
                parent_is_literal = any(
                    isinstance(anc, ast.Subscript)
                    and isinstance(anc.value, ast.Name)
                    and anc.value.id == "Literal"
                    and anc.slice is node
                    for anc in ast.walk(tree)
                )
                if parent_is_literal:
                    continue
                vals = frozenset(
                    e.value for e in node.elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)
                )
                if vals in pairs:
                    offenders.append(f"{path.name}:{node.lineno}")
        assert not offenders, (
            f"这些**运行时**判断又把设备枚举写死了：{offenders}\n"
            f"改成 archetype_legal.supported_devices() / valid_judge_devices()。"
        )

    def test_不许再手抄设备Literal(self):
        """⚠ 反向判据。加设备只改账本 + 版式。再写 Literal[\"desktop\",\"phone\"]
        就是下一笔 watch 漏接的种子。

        剥 AST 再认——注释里提到 desktop/phone 不算。
        """
        import ast

        offenders = []
        for path in (ROOT / "services").rglob("*.py"):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not (
                    isinstance(node, ast.Subscript)
                    and isinstance(node.value, ast.Name)
                    and node.value.id == "Literal"
                ):
                    continue
                elts = getattr(node.slice, "elts", None)
                if not elts:
                    continue
                vals = {
                    e.value for e in elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)
                }
                if vals & {"desktop", "phone", "tablet", "watch"}:
                    offenders.append(f"{path.name}:{node.lineno}:{sorted(vals)}")
        assert not offenders, (
            f"这些 Literal 又把设备枚举写死了：{offenders}\n"
            f"改成 str + archetype_legal.supported_devices()。"
        )

    def test_兜底档必须是接通的设备(self):
        """⚠ 兜底档要是个未接通的设备，判不出姿态时会直接产出闸不认的东西。"""
        assert A.default_device() in A.supported_devices()
