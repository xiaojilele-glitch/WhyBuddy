# -*- coding: utf-8 -*-
"""闭环判定读的是**账上有什么**，不是「本轮生成过什么」（2026-09-04 连锁药店）。

## 事故

真机 sr-20260904172213「连锁药店处方审核 / 特药双人复核 / 效期预警」：

    turn-1  spec,pages,structure,bind  →（首跳超时）落库 0 份
    turn-1  pages,structure,bind       → 产汇合模型，落库 5 份，mv-1
    turn-5  structure                  → mv-2
    turn-7  bind                       → mv-3（六段齐）
    turn-9  closure ← 用户答「进行闭环判定」
            [v5_capability_executor] spec-first 单跳完成（无汇合模型）
            闭环=blocked(1):APPBUNDLE_RUNTIME_CLOSURE_BLOCKED   证据 0/6

库里躺着一份六段齐全的模型 + 5 份页面 + 5 条绑定，判定说「一段证据都没有」。

**今天 15 个会话里凡是走到闭环的全是 0/6，一个例外都没有。**

## 为什么之前一直没找到

两条独立的退路各自差一点点，凑起来就是必然 0/6：

1. `_try_llm_generate_evidence` 单跳没汇合模型时 `return {}`——**不是 None**。
   精修分支那条「生成失败就沿用上一版」的退路（D2）判的是
   `llm_result is None`，`{}` 从它旁边走过去了，一声不响。
2. 生成侧的复用锁 `reusable_model_for_turn` 锁死单轮（turn-9 ≠ turn-7 不给）。
   那是对的——它防的是「用户补充需求之后仍然拿到旧模型」。但判定侧借它来问
   「有没有东西可判」，就问错了问题。

我自己还错判过一次：以为是「判定跑在产出之前」。后来发现点火那一跳
`appbundle.runtimeClosure` 本来就在生成模型，那个结论只对了一半——真正的错是
**判定侧跳读错了地方**。这份判据钉住的就是这个区分。

## 判据形状

正向那条喂的是**真机那一发的原样载荷**（CLAUDE.md §一之二）：队尾快照挂
turn-7、lastTurnId 是 turn-14、goal 也换过（用户答的是「进行闭环判定」），
生成器返回真机那个 `{}`。不许自己拼一个「刚好能过」的输入。
"""

import pytest

from models.v5_state import V5SessionState
from services.v5_capability_executor import (
    REQUIRED_EVIDENCE_KEYS,
    _build_per_skill_evidence,
)
from services.model_versions import latest_model_snapshot, reusable_model_for_turn

TOPIC = "做一个连锁药店的处方审核、特殊药品双人复核与效期预警系统"


def _model(tag: str = "v3") -> dict:
    return {s: {"id": f"{s}-{tag}", "tag": tag} for s in REQUIRED_EVIDENCE_KEYS}


def _state_like_the_real_run(*, versions=True, model=None) -> V5SessionState:
    """真机 sr-20260904172213 走到 closure 那一跳时的状态形状。"""
    st = V5SessionState(sessionId="sr-20260904172213-GTKSFWSFYW",
                        goal={"text": TOPIC, "status": "clear", "tools": ["closure"]},
                        ownerId="u-1")
    # 判定这一轮不是产模型那一轮——真机就是这样（快照 turn-7，当前 turn-14）
    st.lastTurnId = "turn-14-drive-full"
    if versions:
        st.modelVersions = [{
            "id": "mv-3", "turnId": "turn-7",
            "goalDigest": "706d4d75be0c",          # 老 goal 的指纹，跟本轮对不上
            "instruction": "进入权限与工作流绑定（bind）",
            "model": _model() if model is None else model,
            "createdAt": "2026-09-04T17:31:00",
        }]
    return st


def _present(per_skill) -> int:
    return sum(1 for k in REQUIRED_EVIDENCE_KEYS if per_skill[k]["evidencePresent"])


def _no_merged_model(*_a, **_kw):
    """真机那一发：单跳完成、没有汇合模型 → 空 dict（**不是 None**）。"""
    return {}


@pytest.fixture(autouse=True)
def _llm_off(monkeypatch):
    # 判据不许真调 LLM；生成入口一律由各条自己替换。
    monkeypatch.setattr(
        "services.v5_capability_executor._try_llm_generate_evidence",
        _no_merged_model,
    )
    monkeypatch.setattr(
        "services.v5_capability_executor._cache_spec_first_pages", lambda *a, **k: None
    )


class Test判定读账:
    def test_本轮没产模型_判定读队尾那一版_六段齐(self, monkeypatch):
        """★ 事故本体。修复改回去这条必红。"""
        st = _state_like_the_real_run()
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        assert _present(per_skill) == 6, (
            f"库里躺着六段齐全的模型，判定却只认出 {_present(per_skill)} 段"
            "——这就是真机上那个 0/6"
        )

    def test_读到的确实是队尾那一版的内容_不是空壳(self):
        """光看 evidencePresent 不够：modelSection 得真的带着队尾那份内容。

        （§3 配对：「有名字」≠「东西在」。）
        """
        st = _state_like_the_real_run(model=_model("bind-done"))
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        for skill in REQUIRED_EVIDENCE_KEYS:
            assert per_skill[skill].get("modelSection") == {
                "id": f"{skill}-bind-done", "tag": "bind-done"
            }, f"{skill} 段拿到的不是队尾那一版"

    def test_生成侧那把锁一点没松(self):
        """★ 反向配对：修的是判定侧，**不许**顺手把生成侧的单轮锁放宽。

        放宽它 = 用户补充需求之后仍然拿到旧模型（turborepo#4572 那个坑）。
        """
        st = _state_like_the_real_run()
        assert reusable_model_for_turn(st) is None, (
            "生成侧复用锁被放宽了——turn-14 不该拿得到 turn-7 的模型"
        )
        assert latest_model_snapshot(st) is not None, "判定侧读账反而读不到了"


class Test第二种形状:
    """★ 2026-09-04 17:47，用真机原样载荷回放时抓到的第二种形状。

    第一版护栏写的是「一段都没匹配上才读账」。真机那一发（closure 单跳）确实
    一段都没有，所以它在那一发上是对的——**但只对那一发**：

        _refine_active = True  → 产物 haystack 那圈被跳过 → matches 空 → 护栏成立
        _refine_active = False → haystack 拿 art-N-appbundle.runtimeClosure 这类
                                 **壳产物** id 里的 "appbundle"/"page" 认出 2 段
                                 → matches 非空 → 护栏不成立 → 判定停在 2/6

    2/6 比 0/6 更坏：它看着像「部分证据」，其实那两段是壳，没有 modelSection，
    拼回去是一份空心应用。CLAUDE.md §一之二说的就是这个——护栏装在真跑的路上，
    条件却只在其中一种载荷下成立。判据必须两种形状都钉住。

    改法沿用本文件里既有的那条规则（08-04 事故写下的）：
    **携带模型段的产物优先于不带模型段的 haystack 壳**，按槽位补，不整份顶替。
    """

    def test_壳产物占了坑_照样补齐六段(self):
        st = _state_like_the_real_run()
        # 真机 artifacts 里就有这种壳：id 含 appbundle/page，但没有 _model_section
        st.artifacts = [
            {"id": "art-1-appbundle.runtimeClosure", "kind": "closure",
             "title": "appbundle closure", "summary": "壳"},
            {"id": "art-2-page.compose", "kind": "page", "title": "page", "summary": "壳"},
        ]
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        assert _present(per_skill) == 6, (
            f"壳产物占了 2 个坑，判定停在 {_present(per_skill)}/6"
        )
        for skill in REQUIRED_EVIDENCE_KEYS:
            assert per_skill[skill].get("modelSection"), (
                f"{skill} 认成了「有证据」却没有模型段——空心应用"
            )

    def test_本轮真生成的段不许被账上旧的顶掉(self):
        """反向配对：补的是**空槽**，不是整份顶替。

        顶替 = 本轮辛苦生成的新段被上一版覆盖，用户看到「改了等于没改」。
        """
        st = _state_like_the_real_run(model=_model("账上旧的"))
        fresh = {"id": "rbac-本轮新的", "tag": "本轮新的"}

        def _one_fresh_section(*_a, **_kw):
            return {"rbac": {"id": "llm-linkage-rbac", "title": "rbac",
                             "kind": "runtimeClosureEvidence", "summary": "本轮",
                             "_model_section": fresh}}

        import services.v5_capability_executor as ex
        _orig = ex._try_llm_generate_evidence
        ex._try_llm_generate_evidence = _one_fresh_section
        try:
            per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        finally:
            ex._try_llm_generate_evidence = _orig
        assert per_skill["rbac"]["modelSection"] == fresh, "本轮新生成的 rbac 段被账上旧的顶掉了"
        assert _present(per_skill) == 6, "其余五段没从账上补齐"


class Test该红的还得红:
    def test_账上什么都没有_照旧0段(self):
        """反向配对之一：不凭空造证据。没产物就是没产物（§7 闭环 fail-closed）。"""
        st = _state_like_the_real_run(versions=False)
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        assert _present(per_skill) == 0, "账上一份模型都没有，判定不许判出证据来"

    def test_账上只有半份模型_照旧0段(self):
        """反向配对之二：半份判绿比不判更糟。

        ⚠ 这条盯的是一个真的容易写错的地方：`model_to_linkage_artifacts` 对
          缺的段照样产一个 `_model_section: None` 的壳产物，六个 id **永远齐**。
          拿产物 id 当「六段齐」的判据等于没判据。
        """
        half = _model()
        half["aigc"] = None
        st = _state_like_the_real_run(model=half)
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        assert _present(per_skill) == 0, (
            "半份模型被判成有证据——拼回去会得到一份带 None 段的「完整」应用"
        )

    def test_本轮生成真炸了_照旧0段(self, monkeypatch):
        """反向配对之三：读账是给「本跳按设计不产模型」用的，不是给失败擦屁股的。

        生成真失败时诊断里有 code，那一轮该 blocked 就 blocked。
        """
        def _boom(*_a, **_kw):
            from services.v5_capability_executor import _diagnostic
            _diagnostic().update({"code": "LLM_GENERATE_FAILED", "detail": "525"})
            return None

        monkeypatch.setattr(
            "services.v5_capability_executor._try_llm_generate_evidence", _boom
        )
        st = _state_like_the_real_run()
        per_skill = _build_per_skill_evidence(st, False, TOPIC, force_llm=True)
        assert _present(per_skill) == 0, (
            "生成失败的那一轮被账上旧模型糊成了 6/6——诊断白留了"
        )

    def test_aigc被信号判黑时_不许被读账翻回来(self):
        """反向配对之四：blocked_signal 那条既有语义不许被绕过。"""
        st = _state_like_the_real_run()
        per_skill = _build_per_skill_evidence(st, True, TOPIC)
        assert per_skill["aigc"]["evidencePresent"] is False


class Test接在真链路上:
    """§1：判据得证明这段代码**在闭环那条路上被执行到**，不是"我抄对了"。"""

    def test_closure单跳走的就是这段_直接执行产线源码(self):
        """闭环能力的入口按 `_host_hop`（单跳且在 FACTORY_HOPS 里）传 force_llm，
        真机 `tools=["closure"]` 满足它——这条直接照产线源码的写法算一遍。
        """
        import ast
        import inspect

        from services import v5_capability_executor as mod

        src = inspect.getsource(mod)
        tree = ast.parse(src)
        # 找 `_host_hop = ...` 那个赋值，拿它的表达式原样跑
        expr = None
        for node in ast.walk(tree):
            if (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)
                    and node.targets[0].id == "_host_hop"):
                expr = node.value
        assert expr is not None, "产线里 `_host_hop` 那行没了——判据跟着失效，去看调用点"
        code = compile(ast.Expression(expr), "<prod>", "eval")
        env = {"FACTORY_HOPS": mod.FACTORY_HOPS}
        assert eval(code, {}, {**env, "_hop_tools": ["closure"]}) is True, (
            "真机 tools=['closure'] 没被当成单跳——force_llm 不会传，读账那段根本走不到"
        )
        assert eval(code, {}, {**env, "_hop_tools": ["pages", "structure", "bind"]}) is False

    def test_读账那段确实挂在证据构建里_不是死代码(self):
        import inspect

        from services.v5_capability_executor import _build_per_skill_evidence as fn

        body = inspect.getsource(fn)
        assert "latest_model_snapshot" in body, (
            "读账没挂在 _build_per_skill_evidence 里——装在不通电的插座上了"
        )
