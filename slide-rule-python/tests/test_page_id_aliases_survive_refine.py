"""页面 id 别名表要跨精修轮累积（2026-08-28）。

## 事故

第 4.5 步把「以页面 id 作键或存页面 id」的七样载体都改了名，**唯独改不到
已经烧进页面 HTML 正文的 data-page-id**——那是第 3.5 步 unify_shell 按当时
的草稿 id 打的孔，`rekey_page_map` 只换 dict 的键、不碰 value 那串 HTML。

真机 sr-20260827191954（药房）四个菜单项全点不动、sr-20260827201847（巡检）
五个全废，而 sr-20260822124211 页键本身还是 p1/p2、孔对得上、菜单是好的
——所以这是第 4.5 步引入的**回归**，不是一直就坏。宿主
`resolveActivePageId` 查不到就静默回落当前页，一声不吭。

修法照 friendly_id 的 History：改名的**那一刻**把映射记下来随页面落库，
宿主解析不到时按它回退（前端判据在
client/src/pages/sliderule/__tests__/menu-click-survives-page-rename.test.ts）。

## 这个文件专管「累积」这一半

`canonical_page_id_map` 的头注写着「一个都没改就返回空表」，而那**正是精修轮
的常态**。于是精修一次，本轮 pageIdAliases 是 {}，直接盖上去就把首轮记下的
p1→remote_rx_audit 抹掉——菜单第二天又点不动了，而且同样不报错。老页面是
被 reuse_pages 照搬回来的，孔里烧的还是首轮那批 id。

合并只能放在落库那一处：流水线拿不到 state（旧值只在 `state.specFirstPages
= got` 之前还活着），往里穿参数要改十几处签名。冲突时**本轮赢**，对应
friendly_id 的 `order(id: :desc)`——同一个旧 id 被指到两个新 id 时，最近那次
改名才是有效的。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services.v5_capability_executor import _cache_spec_first_pages  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


def _stash(pages, aliases):
    sfp._last_pages_var.set({
        "version": "spec-first-pipeline-v1",
        "pages": dict(pages),
        "navItems": [{"id": k, "name": k} for k in pages],
        "pageIdAliases": dict(aliases),
    })


class Test别名跨轮累积:
    def test_首轮把改名记下来(self):
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)
        assert state.specFirstPages["pageIdAliases"] == {"p1": "remote_rx_audit"}

    def test_精修轮没改名也不许把上一轮的别名抹掉(self):
        """⚠ 这条是本文件的理由。

        精修轮 `canonical_page_id_map` 返回空表是常态；照搬回来的老页面里，
        孔烧的还是首轮那批草稿 id。空表直接盖上去 = 菜单再次点不动，
        而且没有一处会报错。
        """
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)

        # 第二轮：页面重画了一遍，但一个都没改名 → 本轮别名表是空的
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">y</a>"}, {})
        _cache_spec_first_pages(state)

        assert state.specFirstPages["pageIdAliases"] == {"p1": "remote_rx_audit"}, (
            "精修轮的空表把首轮的别名抹掉了——菜单会再次静默失灵"
        )

    def test_二次改名时本轮赢(self):
        """同一个旧 id 被指到两个新 id：最近那次改名才是有效的。"""
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"draft2": "<a data-page-id=\"p1\">x</a>"}, {"p1": "draft2"})
        _cache_spec_first_pages(state)

        _stash({"final": "<a data-page-id=\"p1\">x</a>"}, {"p1": "final", "draft2": "final"})
        _cache_spec_first_pages(state)

        aliases = state.specFirstPages["pageIdAliases"]
        assert aliases["p1"] == "final"
        # 中间那个 id 也留着：它不是交付页，但前端展平链式时要用它
        assert aliases["draft2"] == "final"

    def test_页面为空的那一轮什么都不写(self):
        """回落老链路的那一轮不许留下页面——连带别名也不许动上一轮的。"""
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)
        before = dict(state.specFirstPages["pageIdAliases"])

        _stash({}, {"p9": "谁也不是"})
        _cache_spec_first_pages(state)

        assert state.specFirstPages["pageIdAliases"] == before


class Test流水线把别名交出来:
    def test_两条载体都带着别名键(self):
        """⚠ 反向判据：只挂 result 不算数。

        宿主刷新之后唯一的来源是 state.specFirstPages（走 _last_pages_var），
        不是 result——styleBrief 那次就是只挂在 model 上，精修回流被剥成六段，
        接线从出生起没通过电。所以两处都得写，源码里两处都得在。
        """
        src = sfp.__file__
        with open(src, encoding="utf-8") as fh:
            body = fh.read()
        # 剥掉注释再数：本仓踩过"判据 grep 到的词其实在文档字符串里"
        code = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
        assert code.count('"pageIdAliases": dict(_page_id_aliases)') == 2, (
            "result 与 _last_pages_var 两条载体必须都带 pageIdAliases，"
            "只写一条 = 刷新之后别名就没了"
        )


class Test别名是历史_不跟着版本回退:
    """⚠ 2026-08-28 审计出来的洞，补在原修复之后。

    页面 id 别名表有三个写入/读取点：落库、版本快照、版本回退。回退那处是
    `state.specFirstPages = restored.specFirstPages` ——**整份替换**，而旧
    快照里的别名表可能是空的（修复之前的存量版本；或某个没改过名的精修轮，
    canonical_page_id_map 一个都没改就返回空表，那正是精修轮的常态）。

    冲掉 = 菜单又点不动，而且照例一声不吭。别名是历史，模型版本可以回退，
    「p1 曾经是 remote_rx_audit」这件事永远为真——照 friendly_id：slug 历史
    只增，回退文章内容不会把老 slug 从历史表里删掉，否则老链接当场 404。
    """

    def test_合并规则_新的赢(self):
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "old"}, {"p1": "new"}) == {"p1": "new"}
        assert merge_page_id_aliases({"p1": "a"}, {"p2": "b"}) == {"p1": "a", "p2": "b"}

    def test_合并规则_空表不许抹掉已有的(self):
        """这条就是回退那个洞的形状：新的一边是空表。"""
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "remote_rx_audit"}, {}) == {
            "p1": "remote_rx_audit"
        }
        assert merge_page_id_aliases({"p1": "remote_rx_audit"}, None) == {
            "p1": "remote_rx_audit"
        }

    def test_合并规则_自指与脏数据剔掉(self):
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "p1"}, {}) == {}
        assert merge_page_id_aliases({"": "x", "y": ""}, {}) == {}
        assert merge_page_id_aliases("不是表", 42) == {}

    def test_回退那一处真的接上了合并(self):
        """⚠ 反向判据：函数写对了 ≠ 它被调用了。

        整份替换那一行还在的话，上面三条照样全绿——而线上回退一次别名就没了。
        """
        import services.rehearsal_control as rc

        with open(rc.__file__, encoding="utf-8") as fh:
            body = fh.read()
        code = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
        at = code.index("state.specFirstPages = restored.specFirstPages")
        window = code[at - 400 : at + 500]
        assert "merge_page_id_aliases" in window, (
            "版本回退整份替换了 specFirstPages 却没合并别名表——回退一次菜单就废"
        )


class Test回退的HTTP路也保住别名:
    """⚠ 2026-08-29：上面那条修复**自己就是「只改一半」**（CLAUDE.md 第四条）。

    合并当时补在 `rehearsal_control._tool_restore`（控制面工具）里，而前端
    版本条那颗 ◀ 按钮走的是 `POST /sessions/{sid}/model-versions/{id}/restore`
    → `routes.sliderule_full._restore_model_version_locked` —— **不经过控制面**。
    那一行 `state.specFirstPages = target.get("specFirstPages") or None` 于是
    照旧把整份（连同别名表）清空。

    而且这条路上清空是**常态不是例外**：`_PAGES_KEPT_VERSIONS = 1`，早于最近
    一版的快照页面已经被降级阶梯抹成 None，所以往回退一步以上必然踩到
    `or None`。真机 sr-it-065848-A 的 mv-1/mv-2 快照都是「带页 0 别名 0」。

    修法：合并搬进两条路**共用的那个核**，调用方一个都不用改。
    这条判据直接调那个核，把上面那条 grep 式判据顶掉的正是它——
    grep 判据在合并从 rehearsal_control 搬走之后会变红（那是好事，说明它
    咬的是位置），但只有这条能证明**行为**对。
    """

    @staticmethod
    def _restore(monkeypatch, live_pages, target_pages, mismatch=False, rebuilt=None):
        # ⚠ 2026-08-29：业务核下沉到 services/model_version_restore。
        #   `load_session` / `save_session` 要 patch 在**核所在的模块**上——
        #   patch 到路由模块上不会报错，只会静静地去打真库。
        from services import model_version_restore as srf
        from services import v5_full_driver as drv
        from services import v5_llm_generate as gen
        from services import v5_publish_closure_response as pcr
        from services import v5_skill_runtime_graph as srg

        model = {"datamodel": {"v": 1}, "rbac": {}, "workflow": {}, "aigc": {}}
        state = V5SessionState(sessionId="sr-test-restore", goal={"text": "x"})
        state.specFirstPages = live_pages
        state.modelVersions = [
            {"id": "mv-1", "model": model, "specFirstPages": target_pages},
            {"id": "mv-2", "model": {**model, "datamodel": {"v": 2}}},
        ]
        state.currentModelVersionId = "mv-2"

        saved = {}
        monkeypatch.setattr(srf, "load_session", lambda sid: state)
        monkeypatch.setattr(srf, "save_session", lambda s: saved.setdefault("s", s) or s)

        # ⚠ 真身在重建过程中会 persist_state 三次。这个替身把**重建那一刻看见
        #   的交付物**记下来，判据据此证明"落库的那几笔里没有被抹空的版本"。
        seen = {}

        def _rebuild(s, *a, **k):
            seen["pages"] = getattr(s, "specFirstPages", None)
            if rebuilt is not None:
                s.specFirstPages = rebuilt
            return s

        monkeypatch.setattr(drv, "_ensure_runtime_closure_evidence", _rebuild)
        monkeypatch.setattr(
            drv,
            "extract_model_from_closure",
            (lambda c: {**model, "datamodel": {"v": 99}}) if mismatch else (lambda c: model),
        )
        monkeypatch.setattr(pcr, "derive_publish_closure_response", lambda s: {"ok": True})
        monkeypatch.setattr(srg, "derive_skill_runtime_graph_response", lambda s: None)
        monkeypatch.setattr(gen, "set_model_override", lambda m: None)
        monkeypatch.setattr(gen, "set_refine_context", lambda *a, **k: None)

        out = srf.restore_model_version_locked("sr-test-restore", "mv-1")
        if mismatch:
            assert getattr(out, "status_code", None) == 409, out
        else:
            assert out.get("restored") is True, out
        return state.specFirstPages, seen.get("pages")

    def test_目标快照被降级抹空时别名要留下(self, monkeypatch):
        """最常见的那一种：往回退一步，快照的页早被 _PAGES_KEPT_VERSIONS 抹了。"""
        got, _ = self._restore(
            monkeypatch,
            live_pages={"pages": {"rx_audit": "<html>甲</html>"},
                        "pageIdAliases": {"p1": "rx_audit"}},
            target_pages=None,
        )
        assert (got or {}).get("pageIdAliases") == {"p1": "rx_audit"}, (
            "回退把别名表冲掉了——交付 HTML 里按 p1 写死的菜单锚点当场点不动"
        )

    def test_页面照旧跟着版本回退(self, monkeypatch):
        """⚠ 反向判据：别把「保住别名」做成「保住上一版的页」。

        那是 D8 那个病的交付物版本——指针回到 v1、右侧还是 v3 的页面。
        """
        got, _ = self._restore(
            monkeypatch,
            live_pages={"pages": {"rx_audit": "<html>新</html>"},
                        "pageIdAliases": {"p1": "rx_audit"}},
            target_pages=None,
        )
        assert not (got or {}).get("pages"), "页面必须跟着版本走，不许拿新版的页冒充旧版"

    def test_目标快照自己带别名时两边都在(self, monkeypatch):
        got, _ = self._restore(
            monkeypatch,
            live_pages={"pages": {}, "pageIdAliases": {"p2": "stock_move"}},
            target_pages={"pages": {"rx_audit": "<html>甲</html>"},
                          "pageIdAliases": {"p1": "rx_audit"}},
        )
        assert (got or {}).get("pageIdAliases") == {
            "p1": "rx_audit",
            "p2": "stock_move",
        }
        assert (got or {}).get("pages") == {"rx_audit": "<html>甲</html>"}

    def test_两边都没别名时不留空壳(self, monkeypatch):
        """没有别名可留就老老实实置空——留个 {"pageIdAliases": {}} 会让

        `state.specFirstPages is None` 这类判定（app_working_session 有一处）
        看见一份"有东西"的空壳。
        """
        got, _ = self._restore(monkeypatch, live_pages={"pages": {}}, target_pages=None)
        assert got is None, got


class Test回退失败不许把交付页烧掉:
    """⚠ 2026-08-29 真机 sr-it-065848-A：**409「指针未移动」骗了人。**

    原来的顺序是 先抹页 → 重建 → D8 判定。而重建内部有三处 `persist_state`
    （capability_start / complete / error），核心集合都在增长，单调守卫一路
    放行——抹空的那份**在判定之前就落了库**。于是 409 返回「指针未移动」，
    库里 `payload->'specFirstPages'->'pages'` 已经不存在：回退前 6 张交付页，
    回退失败之后 0 张，右侧当场变空。

    ⚠ 而且补不回来：同一个 lastTurnId 再 save 一次会被单调守卫退回旧值
    （specFirstPages 不在豁免键里）。所以唯一的修法是**判完再动手**，
    不是"出错了再回滚"。

    照 grok-build `verify_published`：先跑、回读比对、判完再提交。
    """

    def test_重建期间交付物一个字都没动(self):
        """最直接的那条：重建那一刻看见的，必须还是回退前那份。

        ⚠ 这条盯的是**时序**，不是终值。只看终值的判据会被"先抹后补"骗过去
        ——而落库正好发生在中间那一段。
        """
        import pytest

        live = {"pages": {"rx_audit": "<html>甲</html>"},
                "pageIdAliases": {"p1": "rx_audit"}}
        mp = pytest.MonkeyPatch()
        try:
            _, seen = Test回退的HTTP路也保住别名._restore(mp, live_pages=live, target_pages=None)
        finally:
            mp.undo()
        assert seen == live, (
            f"重建开始时交付物已经被改成 {seen}——重建里的 persist_state 会把它落库，"
            "而 D8 随后可能判 409，那时页就再也回不来了"
        )

    def test_D8判不通过时页原样留着(self):
        import pytest

        live = {"pages": {"rx_audit": "<html>甲</html>"},
                "pageIdAliases": {"p1": "rx_audit"}}
        mp = pytest.MonkeyPatch()
        try:
            got, seen = Test回退的HTTP路也保住别名._restore(
                mp, live_pages=live, target_pages=None, mismatch=True
            )
        finally:
            mp.undo()
        assert got == live, f"409 之后交付物被改成了 {got}"
        assert seen == live

    def test_重建自己画出新页时不许再抹掉(self):
        """⚠ 反向判据：别把"判完再动手"做成"判完一律置空"。

        重建是在 set_model_override(目标版本模型) 之下跑的，它画出来的页
        本来就是目标版本的页——换一块空白才是说谎（跟 D8 同一个病）。
        """
        import pytest

        fresh = {"pages": {"rx_audit_v1": "<html>老版</html>"}}
        mp = pytest.MonkeyPatch()
        try:
            got, _ = Test回退的HTTP路也保住别名._restore(
                mp,
                live_pages={"pages": {"rx_audit": "<html>新</html>"},
                            "pageIdAliases": {"p1": "rx_audit"}},
                target_pages=None,
                rebuilt=fresh,
            )
        finally:
            mp.undo()
        assert (got or {}).get("pages") == fresh["pages"], got
        assert (got or {}).get("pageIdAliases") == {"p1": "rx_audit"}, got
