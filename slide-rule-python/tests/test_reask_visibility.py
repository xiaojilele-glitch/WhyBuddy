"""重问要留痕（2026-08-16）。

## 为什么补这条

真机一趟 543.3s，逐阶段拆开：

    汇合过闸   平常 9~12s → 这趟 **82.6s**
    打孔       上一趟 50.4s → 这趟 **101.8s**

两处都慢了一倍以上，而**日志里一个字都没有**——查不出重问过几次、因为什么。
慢 8 倍却说不出原因，等于这一步对运维是黑的。

⚠ 查下来仓里**四个重问循环全是静默的**（spec_tree / model_assembly /
  html_bindings / html_structure），只有最终失败才打一行。这不是某一处的疏漏，
  是同一个盲区重复了四次。这次先补花时间最多的两处。

⚠ 判据钉在「重问时必须打印」，不钉措辞：措辞会改，而"有没有留痕"不该变。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.html_bindings import HtmlBindingsError, bind_page  # noqa: E402
from services.model_assembly import ModelAssemblyError, assemble  # noqa: E402

#: ⚠ 用 monkeypatch 换掉 assemble_mechanical，绕开 HtmlStructure /
#:   SpecSemantics 的形状校验——本文件要测的是**重问循环有没有留痕**，
#:   不是那两个模型的字段。拿真夹具会把用例绑死在跟它无关的 schema 上，
#:   schema 一改这条就红，而它测的东西根本没变。
SKELETON = {
    "datamodel": {"entities": [{"id": "e1", "name": "甲", "fields": [{"id": "f1", "name": "字段"}]}]},
    "rbac": {"roles": [{"id": "r1", "name": "角色"}], "permissions": [], "menus": []},
    "workflow": {"id": "main_flow", "name": "主流程", "nodes": [], "transitions": []},
    "page": {"pages": [{"id": "p1", "name": "页", "kind": "list",
                        "fieldBindings": [], "actionPermissions": []}]},
    "aigc": {"capabilities": []},
    "appbundle": {"landingPageRef": "", "preferredDevice": "desktop"},
}


@pytest.fixture
def fake_skeleton(monkeypatch):
    import services.model_assembly as ma

    monkeypatch.setattr(ma, "assemble_mechanical", lambda *_a, **_k: dict(SKELETON))


class Test汇合过闸重问留痕:
    def test_重问时打印(self, capsys, fake_skeleton):
        """★ 真机那 82.6s 现在能说出原因了。"""
        calls = {"n": 0}

        def bad_llm(_messages):
            calls["n"] += 1
            return {"pages": []}  # 恒不过闸

        with pytest.raises(ModelAssemblyError):
            assemble({}, {}, {}, llm_json_fn=bad_llm, max_reask=2)
        out = capsys.readouterr().out
        assert "重问第 1 次" in out and "重问第 2 次" in out
        assert calls["n"] == 3, "重问次数跟 max_reask 对不上"

    def test_打印里带原因(self, capsys, fake_skeleton):
        """⚠ 只打"重问了"没用——要能看出**为什么**，否则还是查不下去。

        ⚠ 这条第一版是去源码里查有没有 `last` 这个词，**变异测试没咬住**：
          把 f-string 换成「（原因略）」之后 `last` 仍然出现在紧邻的
          `feedback = last` 里，正则照样命中。查源码有没有某个变量名，
          证明不了那个变量**被打出来了**。改成直接看打印内容。
        """
        with pytest.raises(ModelAssemblyError):
            assemble({}, {}, {}, llm_json_fn=lambda _m: {"pages": []}, max_reask=1)
        out = capsys.readouterr().out
        assert "重问第 1 次" in out
        # 闸的裁决里一定带路径（形如 `appbundle.landingPageRef：…`）
        assert "landingPageRef" in out or "：" in out.split("重问第 1 次：", 1)[-1][:80], (
            f"重问那行没把闸的裁决带上：{out[:200]}"
        )

    def test_不重问就不打印(self, capsys, fake_skeleton):
        """⚠ 反向：正常路径不许有噪声——判据自己变成噪声源就会被人忽略。

        ⚠ 这条第一版想构造"一次就过闸"的夹具，但那要拼一份能过六段闸的完整
          模型，用例会绑死在跟它无关的 schema 上。改成 max_reask=0：
          一次都不重问，那行 print 就永远够不着——**同样证明它只在重问时打**，
          而且不依赖任何模型形状。
        """
        with pytest.raises(ModelAssemblyError):
            assemble({}, {}, {}, llm_json_fn=lambda _m: {"pages": []}, max_reask=0)
        assert "重问第" not in capsys.readouterr().out


class Test打孔重问留痕:
    def test_重问时打印页号与原因(self, capsys):
        model = {"datamodel": {"entities": SKELETON["datamodel"]["entities"]}}

        class Resp:
            content = "<html><body>没有孔</body></html>"

        with pytest.raises(HtmlBindingsError):
            bind_page("<html></html>", model, "p7",
                      llm_call=lambda *_a, **_k: Resp(), max_reask=1)
        out = capsys.readouterr().out
        assert "p7" in out and "重问第 1 次" in out


class Test另外两处还是黑的:
    """⚠ 如实记账：spec_tree 与 html_structure 的重问**仍然静默**。

    这次只补了花时间最多的两处。留这条用例是为了让下一个人知道
    "那两处还没补"，而不是以为整条链都留痕了——**半份覆盖当成全份**
    是本仓反复踩的形状。
    """

    @pytest.mark.parametrize("mod", ["spec_tree", "html_structure"])
    def test_已知未覆盖(self, mod):
        import importlib
        import inspect

        src = inspect.getsource(importlib.import_module(f"services.{mod}"))
        assert "重问第" not in src, (
            f"{mod} 补了重问留痕——好事，把它从这条用例里移出去，"
            f"顺手更新文件头那段说明"
        )
