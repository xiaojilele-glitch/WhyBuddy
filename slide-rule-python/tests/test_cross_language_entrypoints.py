# -*- coding: utf-8 -*-
"""跨语言入口：Node 用**拼出来的字符串**加载的 Python 模块（2026-08-29 夜）。

## 这道闸补的是一个没人守的洞

`server/index.ts:1221` 的 `createPythonWebAigcAdapter` 会起一个 Python 子进程，
在里面按名字动态加载模块：

    mod_name = "services.web_aigc_" + adapter.replace("-", "_") + "_adapter"
    mod = __import__(mod_name, fromlist=["*"])
    for name in ["execute_" + adapter.replace("-","_") + "_runtime_bridge", ...]:
        fn = getattr(mod, name, None)

Node 侧接了四个 adapter：`open` / `orchestration` / `web_qa` / `device_location`。

**这条边任何一侧的静态分析都看不见**：模块名是在 TypeScript 里拼出来的字符串，
在另一个进程里被 `__import__`。于是——

- Python 的依赖图里这四个模块**入度为 0**，显示成"没人 import"；
- TS 的依赖图里根本没有指向 Python 的边（那是 `-c` 传进去的源码）；
- 改名、删除、或者把 `execute_*_runtime_bridge` 重命名，**两边的判据全绿**，
  线上表现是 `{"ok": false, "code": "py_bridge"}` ——一个降级信封，不是崩溃。

## ⚠ 这正是 §26 / §30 两次都判错的那批

`docs/欠缺模块清单-对照Claude与Grok-build.md` §26 把 54 个零入度模块归成
「Node 边界镜像 / 脚本插座 / 未挂载的基线面」三类；§30 订正说其中 18 个是
「Python 自己拥有却没人 import」，可能是"接线漏了"或"确实死了"。

**两次都漏了第三种可能：接线在，只是在另一门语言里。**

2026-08-29 夜照着 Node 那段代码原样跑了一遍，四个 adapter 全部：
模块导得进、桥函数找得到。它们是**产线代码**，不是待删清单，也不是"接线漏了"。

零入度不等于没人用——这是本仓「用错的测量替自己下结论」的第六次。

## 所以这里钉两头

改名会静默失效，所以两头都得钉：Python 侧模块与函数**真的存在**（正向），
Node 侧**仍然按这个规则拼名字**（反向）——只钉一头等于没钉。
"""

from __future__ import annotations

import os
import pathlib
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parent
NODE_ENTRY = REPO / "server" / "index.ts"

#: Node 侧 `createPythonWebAigcAdapter("…")` 接的 adapter。**只许变多不许悄悄变少**：
#: 少一个就是某条 web-aigc 长尾没人服务了。
ADAPTERS = ("open", "orchestration", "web_qa", "device_location")


def _module_name(adapter: str) -> str:
    """与 server/index.ts:1234 的拼法逐字一致。"""
    return "services.web_aigc_" + adapter.replace("-", "_") + "_adapter"


def _bridge_name(adapter: str) -> str:
    """与 server/index.ts:1238 的首选名逐字一致。"""
    return "execute_" + adapter.replace("-", "_") + "_runtime_bridge"


class Test每个跨语言入口都真的在:
    """正向判据：Node 拼出来的名字，Python 这边真的解析得到。"""

    @pytest.mark.parametrize("adapter", ADAPTERS)
    def test_模块导得进来(self, adapter: str) -> None:
        name = _module_name(adapter)
        __import__(name, fromlist=["*"])

    @pytest.mark.parametrize("adapter", ADAPTERS)
    def test_桥函数找得到(self, adapter: str) -> None:
        mod = __import__(_module_name(adapter), fromlist=["*"])
        fn = getattr(mod, _bridge_name(adapter), None)
        assert callable(fn), (
            f"{_module_name(adapter)} 里没有 {_bridge_name(adapter)}。\n"
            f"Node（server/index.ts:1238）按这个名字找函数，找不到就返回 "
            f'{{"ok": false, "code": "py_bridge"}}——**降级信封，不是崩溃**，'
            f"线上不会有任何告警。"
        )


@pytest.fixture(scope="module")
def node_src() -> str:
    assert NODE_ENTRY.exists(), f"找不到 {NODE_ENTRY}"
    return NODE_ENTRY.read_text(encoding="utf-8")


class Test_Node侧仍然按这个规则拼名字:
    """⚠ 反向判据。只钉 Python 侧等于没钉：Node 那边把拼法一改，
    Python 这边四个模块照样在、判据照样绿，而链路已经断了。"""

    def test_模块名拼法没变(self, node_src: str) -> None:
        assert 'mod_name = "services.web_aigc_" + adapter.replace("-", "_") + "_adapter"' in node_src, (
            "server/index.ts 里拼 Python 模块名的那行变了。\n"
            "改了拼法就要同步改本文件的 _module_name——否则这道闸在守一个不存在的契约。"
        )

    def test_桥函数名拼法没变(self, node_src: str) -> None:
        assert '"execute_" + adapter.replace("-", "_") + "_runtime_bridge"' in node_src, (
            "server/index.ts 里拼桥函数名的那行变了，同步改本文件的 _bridge_name。"
        )

    def test_接的adapter名单没变(self, node_src: str) -> None:
        """⚠ 名单只许变多。少一个 = 某条 web-aigc 长尾静默失去 Python 服务。"""
        wired = set(re.findall(r'createPythonWebAigcAdapter\("([^"]+)"\)', node_src))
        assert wired, "server/index.ts 里一个 createPythonWebAigcAdapter 都没有了——整条桥被拆了？"
        missing = sorted(set(ADAPTERS) - wired)
        assert not missing, (
            f"这些 adapter 在 Node 侧不再接 Python 了：{missing}。\n"
            f"要么是有意下线（那就从本文件的 ADAPTERS 里删掉，并说明），"
            f"要么是接线掉了（那就是线上少了一块，且不会报错）。"
        )

    def test_新接的adapter必须同步进名单(self, node_src: str) -> None:
        """⚠ 反向判据的另一半：Node 新接一个而这里没加，
        那个新 adapter 就是下一个"没人守的跨语言入口"。"""
        wired = set(re.findall(r'createPythonWebAigcAdapter\("([^"]+)"\)', node_src))
        extra = sorted(wired - set(ADAPTERS))
        assert not extra, (
            f"Node 新接了 Python adapter 但本文件没跟上：{extra}。\n"
            f"加进 ADAPTERS，这样它的模块和桥函数才会被钉住。"
        )


class Test这道闸咬得动:
    """⚠ 防空转。四个 adapter 全在的时候，「判据坏了」和「确实都在」
    长得一模一样——本仓旧账：一个报 0 的扫描器和一条全绿的判据是同一种东西。"""

    def test_模块不存在时会红(self) -> None:
        with pytest.raises(ImportError):
            __import__(_module_name("definitely_not_an_adapter"), fromlist=["*"])

    def test_桥函数不存在时找得出来(self) -> None:
        mod = __import__(_module_name("open"), fromlist=["*"])
        assert getattr(mod, _bridge_name("no_such_adapter"), None) is None
