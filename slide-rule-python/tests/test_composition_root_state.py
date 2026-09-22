# -*- coding: utf-8 -*-
"""装配根标记：下层定义、装配根注入（2026-08-29）。

## 换掉了什么

`external_provider_cutover` 原来在函数体里 `import app` 来判断「python 服务
部署没部署」。方向是反的（业务层依赖装配根），而且**这个判据永远不会红**：
uvicorn 用 `app:app` 起进程，`sys.modules['app']` 早就在了，那句 import 拿的
是缓存必然成功；app 真炸了的话进程根本起不来，没人调得到这个接口。

现在改成装配根装完自己钉标记、探针去读——方向朝下，环断了，而且判据能红。

## ⚠ 这个文件的第一条判据在盯什么

不是「函数在不在」，是**「import app 之后标记真的在」**（CLAUDE.md 第三条）。
`app.py` 尾巴上那一行被删掉、或者被缩进进 `if _spa_static.exists():`，
探针就永远报 degraded——不报错、不告警，只是那个 provider 一直是黄的。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import composition_root_state as crs  # noqa: E402


class Test装配根真的钉了:
    def test_import_app之后标记就在(self):
        """⚠ 第一条。那一行没执行 = 探针永远黄，而且一声不吭。"""
        import app  # noqa: F401

        ready = crs.composition_root_ready()
        assert ready is not None, (
            "import app 之后装配根标记还是 None——app.py 尾部那行 "
            "mark_composition_root_ready 没执行（被删了？被缩进进 if 里了？）"
        )
        assert ready.get("routers", 0) > 0, "装配根报了 0 条路由，等于没装"

    def test_那一行在模块顶层不在任何if里(self):
        """⚠ 反向判据。缩进错了照样能跑通上面那条（本机有前端包），
        但没打包的机器上会静默失效——正是第四条「只改一半」的形状。"""
        import ast
        import pathlib

        src = pathlib.Path(
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py")
        ).read_text(encoding="utf-8")
        tree = ast.parse(src)
        # app.py 里那句 import 是带 as 的，所以先把「绑到哪个名字上」解出来，
        # 别去 grep 字面量——改个别名判据就该跟着走，不该直接变红。
        names = {
            (a.asname or a.name)
            for n in tree.body
            if isinstance(n, ast.ImportFrom) and n.module == "services.composition_root_state"
            for a in n.names
            if a.name == "mark_composition_root_ready"
        }
        assert names, "app.py 模块顶层没有 import mark_composition_root_ready"
        called = [
            n
            for n in tree.body  # 只看模块顶层，缩进进 if/try 的一律不算
            if isinstance(n, ast.Expr)
            and isinstance(n.value, ast.Call)
            and isinstance(n.value.func, ast.Name)
            and n.value.func.id in names
        ]
        assert called, "app.py 模块顶层没有 mark_composition_root_ready(...) 这一句"


class Test没装配时不许发绿灯:
    """⚠ 换掉旧写法的全部理由。旧的那条线上只能返回 ready。"""

    def test_没钉标记时探针报degraded(self, monkeypatch):
        from services.external_provider_cutover import _check_deployed_python_service

        monkeypatch.setattr(crs, "_READY", None)
        check = _check_deployed_python_service(0.0)
        assert check["status"] == "degraded", "没装配却发了绿灯"
        assert "not assembled" in check["reason"]

    def test_钉了标记才报ready(self, monkeypatch):
        from services.external_provider_cutover import _check_deployed_python_service

        monkeypatch.setattr(crs, "_READY", {"routers": 7, "title": "t"})
        check = _check_deployed_python_service(0.0)
        assert check["status"] == "ready"
        assert check["metadata"].get("routers") == 7, "自述没透出去，判据就没内容"


class Test方向不许再反过来:
    """架构闸盯着组间环，这里再点名钉一次源码级的——这条边有前科。"""

    def test_探针不许再import装配根(self):
        import pathlib
        import re

        from services import external_provider_cutover as epc

        src = pathlib.Path(epc.__file__).read_text(encoding="utf-8")
        # ⚠ 先剥注释和 docstring：上面模块头里就写着 `import app` 这四个字，
        # 不剥的话这条判据变异之后照样绿（CLAUDE.md 第二条踩过的原形）。
        code = re.sub(r'"""[\s\S]*?"""', "", src)
        code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("#"))
        assert not re.search(r"^\s*import\s+app\b", code, re.M), (
            "探针又反过来 import 装配根了——组间环会长回来"
        )

    def test_叶子模块自己不依赖任何人(self):
        import pathlib
        import re

        src = pathlib.Path(crs.__file__).read_text(encoding="utf-8")
        code = re.sub(r'"""[\s\S]*?"""', "", src)
        assert not re.search(r"^\s*from\s+\.", code, re.M), "叶子开始依赖 services 里别的模块了"
