"""SPEC 说要几页，就得交几页——少一页必须说得出话（2026-08-14）。

## 真机撞出来的缺口

市政园林那轮：SPEC 声明 5 页，第 3 步 `got=4 failed=1`（一页生成失败），
后面 4/5/6/6.5 全部按 **4 页**跑完，闭环 6/6、blocked=false、证据 6/6。

**没有任何一处提过"少了一页"。**

## 为什么第 4 步那道判据没抓到

`html_structure.check_page_coverage` 守的是「喂几份 HTML → 出几个页面」，
它比的是**这一步的输入**。而缺页发生在它上游：第 3 步少产一页，第 4 步
收到的就是少了的那份，喂 4 出 4——**判据全绿，缺口在它管辖范围之外**。

这就是今天反复出现那个形状的又一次变体，只是错位换了个地方：
不在某一步内部，而在「SPEC 声明的」与「实际交付的」之间。
两道判据各自都对，中间那条缝没人管。

## 只记不拦

单页失败本来就是 fail-open 设计——另外几页已经烧掉几分钟，不该被一页
拖垮。所以这里补的是**让它说得出话**，不是改成 fail-closed。

## 比 id 不比数量

只比数量的话，「少了 p5、多了 p9」会两两相消：数字对得上而内容错位。
本仓在别处栽过这种"数对了东西不对"。
"""

import os
import sys
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_first_pipeline as sfp  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


def _spec(page_ids):
    return {
        "appName": "测试应用",
        "pages": [
            {"id": p, "name": p, "purpose": "干点什么", "audience": "谁"} for p in page_ids
        ],
        "nodes": [],
        "successCriteria": [],
    }


def _run(monkeypatch, *, declared, produced) -> Dict[str, Any]:
    """跑一趟 run_spec_first，控制 SPEC 声明几页、第 3 步实际产出几页。

    后面几步全部打桩——本文件只验对账，不验它们。
    """
    monkeypatch.setattr(sfp, "spec_first_enabled", lambda: True, raising=False)

    from services import spec_tree, spec_page_html, page_shell
    from services import html_structure, spec_semantics, model_assembly, html_bindings

    class _Spec:
        def model_dump(self, mode="json"):
            return _spec(declared)

    monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda *a, **k: _Spec(), raising=False)
    monkeypatch.setattr(
        spec_page_html, "generate_pages_parallel",
        lambda *a, **k: {
            "pages": {p: f"<main>{p}</main>" for p in produced},
            "failed": {p: "用例注入：这一页挂了" for p in declared if p not in produced},
        },
        raising=False,
    )
    monkeypatch.setattr(
        page_shell, "unify_shell",
        lambda pages, *a, **k: {"pages": dict(pages), "navItems": []}, raising=False,
    )
    monkeypatch.setattr(page_shell, "check_shell_consistency", lambda *a, **k: [], raising=False)

    class _M:
        def model_dump(self, mode="json"):
            return {"entities": [], "pages": []}

    monkeypatch.setattr(html_structure, "derive_structure", lambda *a, **k: _M(), raising=False)
    monkeypatch.setattr(spec_semantics, "derive_semantics", lambda *a, **k: _M(), raising=False)
    monkeypatch.setattr(
        model_assembly, "assemble", lambda *a, **k: {"model": {"ok": True}}, raising=False
    )
    monkeypatch.setattr(
        html_bindings, "bind_pages",
        lambda pages, model, **k: {"pages": dict(pages), "failed": {}}, raising=False,
    )

    return sfp.run_spec_first("做个系统", llm_json_fn=lambda _m: {})


class Test少一页必须说得出话:
    def test_缺页被点名_不只是数字对不上(self, monkeypatch):
        res = _run(monkeypatch, declared=["p1", "p2", "p3"], produced=["p1", "p3"])
        assert res["missingPages"] == ["p2"], (
            "SPEC 声明 3 页、只交了 2 页，缺的那页必须被点名——"
            "真机那轮就是这里悄悄少了一页而闭环照样全绿"
        )
        assert res["declaredPages"] == ["p1", "p2", "p3"]

    def test_对账结果要落库_刷新之后仍然说得出(self, monkeypatch):
        """⚠ 只打日志等于只有当场看着的人知道。第二天打开应用中心的人不知道。"""
        _run(monkeypatch, declared=["p1", "p2"], produced=["p1"])
        stashed = sfp.peek_last_pages()
        assert stashed is not None
        assert stashed["missingPages"] == ["p2"]

    def test_一页不缺时是空列表_不是缺这个键(self, monkeypatch):
        """⚠ 空列表和缺键是两回事：空 = 对过账一页不缺；缺键 = 老产物没对过账。
        分不出来的话，将来读的人会把"没对过账"当成"对过了没问题"。"""
        res = _run(monkeypatch, declared=["p1", "p2"], produced=["p1", "p2"])
        assert "missingPages" in res, "恒给出这个键，别用缺席表示没问题"
        assert res["missingPages"] == []


class Test比的是id不是数量:
    def test_少一页多一页不许两两相消(self, monkeypatch):
        """数量都是 2，但内容错位——只比数量的话这里会绿。"""
        res = _run(monkeypatch, declared=["p1", "p2"], produced=["p1", "p9"])
        assert res["missingPages"] == ["p2"], (
            f"少 p2 多 p9 被数量相消了：{res['missingPages']}"
        )


class Test只记不拦:
    def test_缺页不抛错_另外几页照常交付(self, monkeypatch):
        """单页失败是 fail-open 设计：另外几页已经烧掉几分钟，不该被一页拖垮。
        本轮补的是"说得出话"，不是把它改成 fail-closed。"""
        res = _run(monkeypatch, declared=["p1", "p2", "p3"], produced=["p1", "p3"])
        assert set(res["pages"]) == {"p1", "p3"}, "缺一页不该让整批作废"
        # ⚠ 比"模型还在不在"，不比整份相等——理由同 test_四参老_sink_不炸整条链：
        #   model 上会挂 designLanguage（它随模型落库）。
        assert res["model"]["ok"] is True, "后面几步照常跑完"
        assert "p2" in res["failedPages"], "失败原因仍然如实记着"
